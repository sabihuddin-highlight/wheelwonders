const express = require('express');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// Render runs behind a proxy — trust it so req.ip reflects the real client.
app.set('trust proxy', 1);

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
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

let db, inventoryCollection, ordersCollection;

async function connectDB() {
    try {
        await client.connect();
        console.log("🟢 [SYS] Connected to MongoDB.");
        db = client.db('WheelWonders');
        inventoryCollection = db.collection('inventory');
        ordersCollection = db.collection('orders');
    } catch (error) {
        console.error("🔴 [ERR] Database connection failed:", error);
    }
}
connectDB();

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

app.get('/api/inventory', async (req, res) => {
    try {
        const now = Date.now();
        if (inventoryCache.data && inventoryCache.expires > now) {
            return res.json(inventoryCache.data);
        }
        const stock = await inventoryCollection.find({}).toArray();
        inventoryCache = { data: stock, expires: now + INVENTORY_TTL_MS };
        res.json(stock);
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

app.listen(PORT, () => {
    console.log(`🚀 [SYS] WHEEL WONDERS live at http://localhost:${PORT}`);
});
