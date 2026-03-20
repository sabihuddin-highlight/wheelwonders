const express = require('express');
const path = require('path');
const fs = require('fs'); // File System module to read/write our JSON database
const app = express();
const PORT = process.env.PORT || 3000;

// Allow server to understand JSON data sent from the frontend
app.use(express.json());
app.use(express.static('public'));

// --- API ROUTES ---

// 1. Send current stock to the frontend
app.get('/api/inventory', (req, res) => {
    const stock = JSON.parse(fs.readFileSync('./data/inventory.json'));
    res.json(stock);
});

// 2. Process a new order
app.post('/api/checkout', (req, res) => {
    const newOrder = req.body; // Contains customer info and cart data
    
    // Read databases
    let inventory = JSON.parse(fs.readFileSync('./data/inventory.json'));
    let orders = JSON.parse(fs.readFileSync('./data/orders.json'));

    // Check stock & deduct
    let outOfStock = false;
    newOrder.cart.forEach(cartItem => {
        let car = inventory.find(c => c.name === cartItem.name);
        if (car && car.stock >= cartItem.quantity) {
            car.stock -= cartItem.quantity; // Deduct stock
        } else {
            outOfStock = true;
        }
    });

    if (outOfStock) {
        return res.status(400).json({ error: "One or more items are out of stock!" });
    }

    // Add Order ID, Date, and save to Orders database
    newOrder.orderId = "JDM-" + Math.floor(Math.random() * 100000);
    newOrder.date = new Date().toLocaleString();
    newOrder.status = "Pending";
    
    orders.push(newOrder);

    // Save changes back to the JSON files
    fs.writeFileSync('./data/inventory.json', JSON.stringify(inventory, null, 2));
    fs.writeFileSync('./data/orders.json', JSON.stringify(orders, null, 2));

    // Send success message back to the customer
    res.json({ success: true, orderId: newOrder.orderId });
});

app.listen(PORT, () => {
    console.log(`[SYS] WHEEL WONDERS server is live at http://localhost:${PORT}`);
});