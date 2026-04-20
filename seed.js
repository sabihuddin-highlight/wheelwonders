require('dotenv').config(); // Load the secret glovebox
const { MongoClient } = require('mongodb'); // Bring in MongoDB tools
const fs = require('fs'); // Bring back the File System tool just for this script

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

async function uploadData() {
    try {
        await client.connect();
        console.log("🟢 [SYS] Connected to the Cloud Vault...");

        // Access your new database and folder
        const db = client.db('WheelWonders');
        const inventoryCollection = db.collection('inventory');

        // 1. Read your newly fixed local JSON file
        const rawData = fs.readFileSync('./data/inventory.json');
        const inventoryData = JSON.parse(rawData);

        // 2. Clear out the old broken data FIRST!
        await inventoryCollection.deleteMany({});
        console.log("🧹 [SYS] Swept the old cars out of the vault.");

        // 3. Blast the clean data into the cloud!
        const result = await inventoryCollection.insertMany(inventoryData);
        
        console.log(`✅ [SUCCESS] Successfully uploaded ${result.insertedCount} clean cars to MongoDB!`);

    } catch (error) {
        console.error("🔴 [ERROR] Something went wrong:", error);
    } finally {
        // Turn off the injector when finished
        await client.close(); 
    }
}

// Run the function
uploadData();