const express = require('express');
const path = require('path');
require('dotenv').config(); 
// Bring in MongoDB tools AND ObjectId (needed for deleting specific cars)
const { MongoClient, ObjectId } = require('mongodb'); 

const app = express();
const PORT = process.env.PORT || 3000;

// Allow server to understand JSON data sent from the frontend
app.use(express.json());
app.use(express.static('public'));

// --- MONGODB SETUP ---
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

// Create empty variables to hold our database and collections
let db, inventoryCollection, ordersCollection;

async function connectDB() {
    try {
        await client.connect();
        console.log("🟢 [SYS] Successfully connected to the MongoDB Cloud Vault!");
        
        // Connect to the specific database and folders (collections)
        db = client.db('WheelWonders'); 
        inventoryCollection = db.collection('inventory');
        ordersCollection = db.collection('orders');
    } catch (error) {
        console.error("🔴 [ERR] Database connection failed:", error);
    }
}
// Run the connection function when the server starts
connectDB();


// --- ADMIN SECURITY MIDDLEWARE ---
// This acts as a bouncer. No one can add/delete without the exact passcode.
const verifyAdmin = (req, res, next) => {
    const pass = req.headers['x-admin-pass'];
    if (pass === "FURQAN_ADMIN_2026") {
        next(); // Passcode matches, let them into the vault
    } else {
        res.status(403).json({ error: "Unauthorized vault access." });
    }
};


// --- API ROUTES ---

// 1. Send current stock to the frontend
app.get('/api/inventory', async (req, res) => {
    try {
        // Fetch ALL cars from the MongoDB 'inventory' collection
        const stock = await inventoryCollection.find({}).toArray();
        res.json(stock);
    } catch (error) {
        console.error("Error fetching inventory:", error);
        res.status(500).json({ error: "Failed to load inventory from database." });
    }
});

// 2. Process a new order
app.post('/api/checkout', async (req, res) => {
    try {
        const newOrder = req.body; // Contains customer info and cart data
        
        let outOfStock = false;
        
        // Step A: Check stock for every item in the cart against the live database
        for (let cartItem of newOrder.cart) {
            const car = await inventoryCollection.findOne({ name: cartItem.name });
            if (!car || car.stock < cartItem.quantity) {
                outOfStock = true;
                break; // Stop checking if even one item is out of stock
            }
        }

        if (outOfStock) {
            return res.status(400).json({ error: "One or more items are out of stock!" });
        }

        // Step B: If stock is good, mathematically deduct it from the database
        for (let cartItem of newOrder.cart) {
            await inventoryCollection.updateOne(
                { name: cartItem.name },
                { $inc: { stock: -cartItem.quantity } } // $inc dynamically decreases the stock
            );
        }

        // Step C: Add Order ID, Date, and save to Orders database
        newOrder.orderId = "JDM-" + Math.floor(Math.random() * 100000);
        newOrder.date = new Date().toLocaleString();
        newOrder.status = "Pending";
        
        // Insert the brand new order directly into the MongoDB 'orders' collection
        await ordersCollection.insertOne(newOrder);

        // Send success message back to the customer
        res.json({ success: true, orderId: newOrder.orderId });

    } catch (error) {
        console.error("Error processing checkout:", error);
        res.status(500).json({ error: "Failed to process order." });
    }
});

// 3. ADMIN: Inject new unit into the database
app.post('/api/admin/inventory', verifyAdmin, async (req, res) => {
    try {
        const newCar = req.body;
        
        // Give it a default stock of 1 if not provided, just to be safe
        newCar.stock = newCar.stock || 1; 

        // Insert directly into MongoDB
        await inventoryCollection.insertOne(newCar);
        
        res.status(201).json({ success: true, message: "Unit injected to database" });
    } catch (error) {
        console.error("Error adding car to vault:", error);
        res.status(500).json({ error: "Failed to inject unit" });
    }
});

// 4. ADMIN: Crush (Delete) unit from the database
app.delete('/api/admin/inventory/:id', verifyAdmin, async (req, res) => {
    try {
        const carId = req.params.id;
        
        // MongoDB requires IDs to be wrapped in "ObjectId()" to find them
        const result = await inventoryCollection.deleteOne({ _id: new ObjectId(carId) });

        if (result.deletedCount === 1) {
            res.status(200).json({ success: true, message: "Unit crushed" });
        } else {
            res.status(404).json({ error: "Unit not found in vault" });
        }
    } catch (error) {
        console.error("Error crushing car:", error);
        res.status(500).json({ error: "Failed to remove unit" });
    }
});

// 5. ADMIN: Quick-tune stock levels (+ / -)
app.put('/api/admin/inventory/:id/stock', verifyAdmin, async (req, res) => {
    try {
        const carId = req.params.id;
        const { change } = req.body; // Expected to be +1 or -1

        // Find the car by ID and physically increment/decrement its stock in MongoDB
        const result = await inventoryCollection.updateOne(
            { _id: new ObjectId(carId) },
            { $inc: { stock: change } }
        );

        if (result.modifiedCount === 1) {
            res.status(200).json({ success: true, message: "Stock adjusted" });
        } else {
            res.status(404).json({ error: "Unit not found in vault" });
        }
    } catch (error) {
        console.error("Error adjusting stock:", error);
        res.status(500).json({ error: "Failed to adjust stock" });
    }
});

// 6. ADMIN: Fetch Customer Order History
app.get('/api/admin/orders', verifyAdmin, async (req, res) => {
    try {
        // Fetch all orders and sort by newest first (-1)
        const orders = await ordersCollection.find({}).sort({ _id: -1 }).toArray();
        res.json(orders);
    } catch (error) {
        console.error("Error fetching orders:", error);
        res.status(500).json({ error: "Failed to load orders." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 [SYS] WHEEL WONDERS server is live at http://localhost:${PORT}`);
});
