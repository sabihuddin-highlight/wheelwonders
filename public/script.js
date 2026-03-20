// Check if a cart already exists in memory, otherwise start empty
let cart = JSON.parse(localStorage.getItem('jdm_cart')) || [];

// Toggle the Cart Panel open and closed
const cartBtn = document.getElementById('cart-btn');
if (cartBtn) {
    cartBtn.addEventListener('click', () => {
        const panel = document.getElementById('cart-panel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
}

// Fetch Inventory from Server and Render
async function loadInventory() {
    try {
        const response = await fetch('/api/inventory');
        const cars = await response.json();
        
        // Grab the new grid sections
        const budgetGrid = document.getElementById('grid-budget');
        const collectorsGrid = document.getElementById('grid-collectors');
        const pinnacleGrid = document.getElementById('grid-pinnacle');
        const premiumGrid = document.getElementById('grid-premium');

        // Clear loading states (if any)
        if (budgetGrid) budgetGrid.innerHTML = '';
        if (collectorsGrid) collectorsGrid.innerHTML = '';
        if (pinnacleGrid) pinnacleGrid.innerHTML = '';
        if (premiumGrid) premiumGrid.innerHTML = '';

        cars.forEach(car => {
            const isOutOfStock = car.stock <= 0;
            
            // Safely escape single quotes in car names (e.g. '95 Mazda) so they don't break the Javascript buttons
            const safeName = car.name.replace(/'/g, "\\'"); 
            
            const buttonHTML = isOutOfStock 
                ? `<button class="buy-btn" disabled style="background: #333; color: #888; border-color: #222; cursor: not-allowed;"><span>SOLD OUT</span></button>`
                : `<button class="buy-btn" onclick="addToCart('${safeName}', ${car.price})"><span>ADD</span> <span>$${car.price.toFixed(2)}</span></button>`;
            
            // Add visual fade if out of stock
            const imageStyle = isOutOfStock ? `opacity: 0.3;` : ``;

            // Give Pinnacle and Premium tiers extra glare effects
            const isHighEnd = (car.tier === 'gold' || car.tier === 'pinnacle' || car.tier === 'premium');
            const tiltEffect = isHighEnd ? 'data-tilt-glare="true" data-tilt-max-glare="0.5"' : '';
            const crownIcon = isHighEnd ? '<i class="fas fa-crown" style="color: inherit;"></i>' : '';

            const cardHTML = `
                <div class="card" data-tilt ${tiltEffect}>
                    <div class="card-inner">
                        <div class="card-img-container" style="background: ${isOutOfStock ? '#111' : '#000'}">
                            <img src="${car.image}" class="card-img" style="${imageStyle}">
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <h3>${car.name}</h3>
                            ${crownIcon}
                        </div>
                        <p>${car.subtitle} ${isOutOfStock ? ' <span style="color:red;">[0 LEFT]</span>' : `[${car.stock} LEFT]`}</p>
                        ${buttonHTML}
                    </div>
                </div>
            `;

            // Smart Routing: Maps your old JSON names to the new HTML Grids
            if ((car.tier === 'sakura' || car.tier === 'budget') && budgetGrid) {
                budgetGrid.innerHTML += cardHTML;
            } else if ((car.tier === 'bronze' || car.tier === 'collectors') && collectorsGrid) {
                collectorsGrid.innerHTML += cardHTML;
            } else if ((car.tier === 'gold' || car.tier === 'pinnacle') && pinnacleGrid) {
                pinnacleGrid.innerHTML += cardHTML;
            } else if (car.tier === 'premium' && premiumGrid) {
                premiumGrid.innerHTML += cardHTML;
            }
        });

        // Re-initialize the 3D tilt effect on the newly created cards
        VanillaTilt.init(document.querySelectorAll(".card"), {
            max: 5, 
            speed: 1000, 
            glare: true, 
            "max-glare": 0.1, 
            scale: 1.02
        });

    } catch (error) {
        console.error("Failed to load inventory:", error);
    }
}

// Add an item to the cart
function addToCart(name, price) {
    const existingItem = cart.find(item => item.name === name);
    if (existingItem) { 
        existingItem.quantity++; 
    } else { 
        cart.push({ name, price, quantity: 1 }); 
    }
    
    // Save to memory
    localStorage.setItem('jdm_cart', JSON.stringify(cart));
    updateCartUI();
}

// NEW: Remove an item entirely from the cart
function removeFromCart(name) {
    // Filter out the item that matches the name
    cart = cart.filter(item => item.name !== name);
    
    // Update memory and visual cart
    localStorage.setItem('jdm_cart', JSON.stringify(cart));
    updateCartUI();
}

// Update the Cart visuals
function updateCartUI() {
    const countSpan = document.getElementById('cart-count');
    const cartList = document.getElementById('cart-items');
    const totalSpan = document.getElementById('cart-total');
    
    if (!countSpan || !cartList) return; // Stops errors if we are on billing page

    countSpan.innerText = cart.reduce((sum, item) => sum + item.quantity, 0);
    cartList.innerHTML = '';
    let total = 0;
    
    cart.forEach((item) => {
        total += (item.price * item.quantity);
        const safeName = item.name.replace(/'/g, "\\'"); // Escape quotes for the remove button
        
        cartList.innerHTML += `
            <li style="margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                <div style="color: var(--bronze); line-height: 1.2;">
                    ${item.name} <br>
                    <span style="font-size: 0.8rem; color: #888;">Qty: ${item.quantity}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span style="color: #fff; font-weight: bold;">$${(item.price * item.quantity).toFixed(2)}</span>
                    <button onclick="removeFromCart('${safeName}')" style="background: transparent; border: none; color: #ff4444; cursor: pointer; font-size: 1.1rem; padding: 0; transition: 0.3s;" onmouseover="this.style.color='#ff0000'" onmouseout="this.style.color='#ff4444'">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </li>`;
    });
    
    totalSpan.innerText = total.toFixed(2);
}

// Button Visual Feedback
document.addEventListener('click', function(e) {
    if (e.target.closest('.buy-btn') && !e.target.closest('#checkout-btn') && !e.target.closest('.buy-btn').disabled) {
        const btn = e.target.closest('.buy-btn');
        const original = btn.innerHTML;
        btn.innerHTML = "<span>ADDED</span><span><i class='fas fa-check'></i></span>";
        btn.style.background = "#fff";
        btn.style.color = "#000";
        
        setTimeout(() => {
            btn.innerHTML = original;
            btn.style.background = "transparent";
            btn.style.color = ""; 
        }, 1000);
    }
});

// Run this when the page loads
if (document.getElementById('grid-budget')) {
    loadInventory();
}
updateCartUI();