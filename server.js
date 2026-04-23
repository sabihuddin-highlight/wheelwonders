const express = require('express');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const crypto = require('crypto');
require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// Render runs behind a proxy — trust it so req.ip reflects the real client.
app.set('trust proxy', 1);

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// --- ANALYTICS: LOG PAGE VISITS (must run BEFORE static so the tracker sees the request) ---
const TRACKED_PATHS = new Set(['/', '/index.html', '/billing.html']);
const BOT_UA = /cron-job|uptimerobot|googlebot|bingbot|bot\/|spider|crawler|curl|wget|python-requests/i;
const ANALYTICS_SALT = process.env.ANALYTICS_SALT || 'ww_default_salt_change_me';

function hashIp(ip) {
    return crypto.createHash('sha256').update(ip + ANALYTICS_SALT).digest('hex').slice(0, 16);
}

function logVisit(req) {
    if (!visitsCollection) return;
    const ua = req.headers['user-agent'] || '';
    if (BOT_UA.test(ua)) return;
    const ip = (req.ip || '').replace(/^::ffff:/, '');
    visitsCollection.insertOne({
        path: req.path,
        ts: new Date(),
        ipHash: hashIp(ip),
        ua: ua.slice(0, 250),
        referrer: (req.headers.referer || req.headers.referrer || '').slice(0, 250),
    }).catch(() => {});
}

app.use((req, res, next) => {
    if (req.method === 'GET' && TRACKED_PATHS.has(req.path)) logVisit(req);
    next();
});

// Product images: long cache + immutable (filenames are unique per car).
app.use('/images', express.static('public/images', { maxAge: '30d', immutable: true }));
// HTML/CSS/JS: shorter cache so content updates propagate within an hour.
app.use(express.static('public', { maxAge: '1h' }));

// 100 requests per hour per IP, API routes only (static files unaffected).
const apiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Try again later." }
});
app.use('/api/', apiLimiter);

// --- MONGODB SETUP ---
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

let db, inventoryCollection, ordersCollection, visitsCollection;

async function connectDB() {
    try {
        await client.connect();
        console.log("🟢 [SYS] Connected to MongoDB.");
        db = client.db('WheelWonders');
        inventoryCollection = db.collection('inventory');
        ordersCollection = db.collection('orders');
        visitsCollection = db.collection('visits');
        // Index ts for fast time-range queries (no-op if already exists)
        visitsCollection.createIndex({ ts: -1 }).catch(() => {});
        warmInventoryCache();
    } catch (error) {
        console.error("🔴 [ERR] Database connection failed:", error);
    }
}
connectDB();

async function warmInventoryCache() {
    try {
        const stock = await inventoryCollection.find({}).toArray();
        for (const doc of stock) {
            if (typeof doc.image === 'string' && doc.image.startsWith('data:')) {
                doc.image = '';
            }
        }
        inventoryCache = { data: stock, expires: Date.now() + INVENTORY_TTL_MS };
        console.log(`🔥 [SYS] Inventory cache warmed with ${stock.length} cars.`);
    } catch (e) {
        console.error("🔴 [ERR] Cache warm failed:", e);
    }
}

// --- ADMIN AUTH ---
const verifyAdmin = (req, res, next) => {
    const pass = req.headers['x-admin-pass'];
    if (pass === process.env.ADMIN_PASSWORD) return next();
    res.status(403).json({ error: "Unauthorized vault access." });
};

const isValidId = (id) => typeof id === 'string' && ObjectId.isValid(id);

// In-memory inventory cache. TTL 60s; busted on admin writes.
let inventoryCache = { data: null, expires: 0 };
const INVENTORY_TTL_MS = 60 * 1000;
const bustInventoryCache = () => { inventoryCache = { data: null, expires: 0 }; };

// --- PUBLIC ROUTES ---

let refreshingCache = false;

app.get('/api/inventory', async (req, res) => {
    const now = Date.now();
    // Serve from cache if we have anything — stale or fresh
    if (inventoryCache.data) {
        res.json(inventoryCache.data);
        // If expired, kick off a background refresh (stale-while-revalidate)
        if (inventoryCache.expires <= now && !refreshingCache) {
            refreshingCache = true;
            warmInventoryCache().finally(() => { refreshingCache = false; });
        }
        return;
    }
    // No cache yet (server just started, DB still connecting) — wait for it
    try {
        await warmInventoryCache();
        if (inventoryCache.data) return res.json(inventoryCache.data);
        res.status(503).json({ error: "Inventory warming up — try again in a moment." });
    } catch (error) {
        console.error("Error fetching inventory:", error);
        res.status(500).json({ error: "Failed to load inventory." });
    }
});

app.post('/api/checkout', async (req, res) => {
    try {
        const { customer, payment, total, cart } = req.body || {};

        if (!customer || typeof customer !== 'object') {
            return res.status(400).json({ error: "Missing customer details." });
        }
        if (!Array.isArray(cart) || cart.length === 0) {
            return res.status(400).json({ error: "Cart is empty." });
        }
        for (const item of cart) {
            if (!item || typeof item.name !== 'string' || !Number.isInteger(item.quantity) || item.quantity < 1) {
                return res.status(400).json({ error: "Invalid cart item." });
            }
        }

        // Atomic stock decrement: findOneAndUpdate with stock filter.
        // If any decrement fails, roll back previously-decremented items.
        const applied = [];
        for (const item of cart) {
            const result = await inventoryCollection.findOneAndUpdate(
                { name: item.name, stock: { $gte: item.quantity } },
                { $inc: { stock: -item.quantity } }
            );
            if (!result) {
                for (const undo of applied) {
                    await inventoryCollection.updateOne(
                        { name: undo.name },
                        { $inc: { stock: undo.quantity } }
                    );
                }
                return res.status(400).json({ error: "One or more items are out of stock!" });
            }
            applied.push(item);
        }

        const orderDoc = {
            customer: {
                name: String(customer.name || '').slice(0, 200),
                phone: String(customer.phone || '').slice(0, 50),
                address: String(customer.address || '').slice(0, 500),
            },
            payment: String(payment || '').slice(0, 50),
            total: Number(total) || 0,
            cart: cart.map(i => ({ name: String(i.name), price: Number(i.price) || 0, quantity: i.quantity })),
            orderId: "JDM-" + Math.floor(Math.random() * 100000),
            date: new Date().toISOString(),
            status: "Pending"
        };

        await ordersCollection.insertOne(orderDoc);
        bustInventoryCache();
        res.json({ success: true, orderId: orderDoc.orderId });

    } catch (error) {
        console.error("Error processing checkout:", error);
        res.status(500).json({ error: "Failed to process order." });
    }
});

// --- ADMIN ROUTES ---

app.post('/api/admin/inventory', verifyAdmin, async (req, res) => {
    try {
        const { name, subtitle, price, stock, tier, image, id } = req.body || {};
        if (!name || !subtitle || price == null || stock == null || !tier) {
            return res.status(400).json({ error: "Missing required fields." });
        }
        const newCar = {
            name: String(name),
            subtitle: String(subtitle),
            price: Number(price),
            stock: Number.isInteger(stock) ? stock : parseInt(stock, 10) || 1,
            tier: String(tier),
            image: String(image || ''),
        };
        if (id) newCar.id = String(id);

        await inventoryCollection.insertOne(newCar);
        bustInventoryCache();
        res.status(201).json({ success: true, message: "Unit injected." });
    } catch (error) {
        console.error("Error adding car:", error);
        res.status(500).json({ error: "Failed to inject unit." });
    }
});

app.delete('/api/admin/inventory/:id', verifyAdmin, async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    try {
        const result = await inventoryCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 1) {
            bustInventoryCache();
            return res.json({ success: true, message: "Unit crushed." });
        }
        res.status(404).json({ error: "Unit not found." });
    } catch (error) {
        console.error("Error crushing car:", error);
        res.status(500).json({ error: "Failed to remove unit." });
    }
});

app.put('/api/admin/inventory/:id/stock', verifyAdmin, async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const change = Number(req.body?.change);
    if (!Number.isFinite(change)) return res.status(400).json({ error: "Invalid change value." });
    try {
        const result = await inventoryCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $inc: { stock: change } }
        );
        if (result.modifiedCount === 1) {
            bustInventoryCache();
            return res.json({ success: true });
        }
        res.status(404).json({ error: "Unit not found." });
    } catch (error) {
        console.error("Error adjusting stock:", error);
        res.status(500).json({ error: "Failed to adjust stock." });
    }
});

app.get('/api/admin/orders', verifyAdmin, async (req, res) => {
    try {
        const orders = await ordersCollection.find({}).sort({ _id: -1 }).toArray();
        res.json(orders);
    } catch (error) {
        console.error("Error fetching orders:", error);
        res.status(500).json({ error: "Failed to load orders." });
    }
});

app.put('/api/admin/inventory/:id', verifyAdmin, async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: "Invalid id." });
    const allowed = ['name', 'subtitle', 'price', 'stock', 'tier', 'image'];
    const updates = {};
    for (const key of allowed) {
        if (req.body && req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No valid fields to update." });
    try {
        const result = await inventoryCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: updates }
        );
        if (result.matchedCount === 1) {
            bustInventoryCache();
            return res.json({ success: true });
        }
        res.status(404).json({ error: "Unit not found." });
    } catch (error) {
        console.error("Error updating unit:", error);
        res.status(500).json({ error: "Failed to update unit." });
    }
});

// --- ANALYTICS DASHBOARD ENDPOINT ---
app.get('/api/admin/analytics', verifyAdmin, async (req, res) => {
    try {
        if (!visitsCollection) return res.status(503).json({ error: "Analytics warming up." });

        const now = new Date();
        const dayAgo = new Date(now - 24 * 3600 * 1000);
        const weekAgo = new Date(now - 7 * 24 * 3600 * 1000);
        const monthAgo = new Date(now - 30 * 24 * 3600 * 1000);

        const [total, today, last7, last30, uniqueMonth, uniqueAllTime, topPages, topRefs, daily, deviceAgg, recent, totalOrders] = await Promise.all([
            visitsCollection.countDocuments(),
            visitsCollection.countDocuments({ ts: { $gte: dayAgo } }),
            visitsCollection.countDocuments({ ts: { $gte: weekAgo } }),
            visitsCollection.countDocuments({ ts: { $gte: monthAgo } }),
            visitsCollection.distinct('ipHash', { ts: { $gte: monthAgo } }).then(a => a.length),
            visitsCollection.distinct('ipHash').then(a => a.length),
            visitsCollection.aggregate([
                { $group: { _id: '$path', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]).toArray(),
            visitsCollection.aggregate([
                { $match: { referrer: { $nin: ['', null] } } },
                { $group: { _id: '$referrer', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 5 }
            ]).toArray(),
            visitsCollection.aggregate([
                { $match: { ts: { $gte: monthAgo } } },
                { $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } },
                    count: { $sum: 1 }
                }},
                { $sort: { _id: 1 } }
            ]).toArray(),
            visitsCollection.aggregate([
                { $match: { ts: { $gte: monthAgo } } },
                { $project: {
                    device: {
                        $switch: {
                            branches: [
                                { case: { $regexMatch: { input: '$ua', regex: 'iPad|Tablet' } }, then: 'tablet' },
                                { case: { $regexMatch: { input: '$ua', regex: 'Mobile|Android|iPhone' } }, then: 'mobile' }
                            ],
                            default: 'desktop'
                        }
                    }
                }},
                { $group: { _id: '$device', count: { $sum: 1 } } }
            ]).toArray(),
            visitsCollection.find({}, { projection: { path: 1, ts: 1, ua: 1, referrer: 1 } })
                .sort({ ts: -1 }).limit(15).toArray(),
            ordersCollection.countDocuments().catch(() => 0)
        ]);

        res.json({
            total, today, last7, last30,
            uniqueMonth, uniqueAllTime,
            totalOrders,
            conversionRate: uniqueMonth > 0 ? +(totalOrders / uniqueMonth * 100).toFixed(2) : 0,
            topPages, topRefs, daily, devices: deviceAgg, recent
        });
    } catch (error) {
        console.error("Error building analytics:", error);
        res.status(500).json({ error: "Failed to load analytics." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 [SYS] WHEEL WONDERS live at http://localhost:${PORT}`);
});
