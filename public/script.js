/**
 * WHEEL WONDERS // CORE LOGIC ENGINE
 * Version: 3.0 (Stage 3 Performance Upgrade)
 */

let allCars = [];
let cart = JSON.parse(localStorage.getItem('jdm_cart')) || [];
let displayLimit = 12; // Controls the "Load More" pagination
let hasInitialRendered = false;

function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Scroll-reveal (cards + .reveal-on-scroll elements). Fires once per element.
const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
        if (e.isIntersecting) {
            e.target.classList.add('revealed');
            revealObserver.unobserve(e.target);
        }
    });
}, { threshold: 0.05, rootMargin: '100px 0px 100px 0px' });

function watchRevealables() {
    document.querySelectorAll('.reveal-on-scroll:not(.revealed)').forEach(el => revealObserver.observe(el));
}

// --- 1. DATA INITIALIZATION ---
async function loadInventory() {
    try {
        const response = await fetch('/api/inventory');
        allCars = await response.json();
        
        // Setup the Brand Filter list dynamically from your 201 cars
        populateBrands();
        
        // Initial draw of the showroom
        processAndRender();
        updateCartUI();
    } catch (error) {
        console.error("CRITICAL: Vault Access Denied (Inventory Load Failed):", error);
    }
}

// FEATURE 1: DYNAMIC BRAND EXTRACTION
function populateBrands() {
    const brandSelect = document.getElementById('brand-filter');
    // Extracts unique brand names from the subtitle (e.g., "NSX / Acura" -> "Acura")
    const brands = [...new Set(allCars.map(car => {
        const parts = car.subtitle.split(' / ');
        return parts[1] ? parts[1].trim() : 'Other';
    }))].sort();

    brands.forEach(brand => {
        const opt = document.createElement('option');
        opt.value = brand;
        opt.innerText = brand.toUpperCase();
        brandSelect.appendChild(opt);
    });
}

// --- 2. THE FILTER & SORT HUB ---
function processAndRender() {
    // Get values from all inputs
    const searchTerm = document.getElementById('search-bar').value.toLowerCase();
    const activeTier = document.querySelector('.filter-btn.active').dataset.filter;
    const sortMode = document.getElementById('sort-price').value;
    const maxPrice = parseInt(document.getElementById('price-slider').value);
    const brandFilter = document.getElementById('brand-filter').value;
    const inStockOnly = document.getElementById('stock-toggle').checked;

    // Filter Logic
    let filtered = allCars.filter(car => {
        const nameMatch = car.name.toLowerCase().includes(searchTerm) || 
                          car.subtitle.toLowerCase().includes(searchTerm);
        const priceMatch = car.price <= maxPrice;
        const brandMatch = (brandFilter === 'all') || car.subtitle.includes(brandFilter);
        const stockMatch = inStockOnly ? car.stock > 0 : true;

        let tierMatch = true;
        if (activeTier !== 'all') {
            if (activeTier === 'budget') tierMatch = (car.tier === 'budget' || car.tier === 'sakura');
            else if (activeTier === 'pinnacle') tierMatch = (car.tier === 'pinnacle' || car.tier === 'gold');
            else if (activeTier === 'premium') tierMatch = (car.tier === 'premium');
            else tierMatch = (car.tier === 'collectors');
        }

        return nameMatch && priceMatch && brandMatch && stockMatch && tierMatch;
    });

    // Sort Logic
    if (sortMode === 'low') filtered.sort((a, b) => a.price - b.price);
    else if (sortMode === 'high') filtered.sort((a, b) => b.price - a.price);

    // FEATURE 5: PAGINATION (Load More)
    const paginatedCars = filtered.slice(0, displayLimit);

    // Toggle "Load More" button visibility
    const loadMoreBtn = document.getElementById('load-more-btn');
    loadMoreBtn.style.display = (filtered.length > displayLimit) ? 'inline-block' : 'none';

    const showroom = document.getElementById('showroom');
    if (!hasInitialRendered) {
        renderGrids(paginatedCars);
        stagedRevealCards();
        hasInitialRendered = true;
    } else {
        // Filter / load-more: quick fade-swap for smoother UX
        showroom.style.opacity = '0';
        setTimeout(() => {
            renderGrids(paginatedCars);
            document.querySelectorAll('.card').forEach(c => c.classList.add('revealed'));
            markLoadedImages();
            showroom.style.opacity = '1';
        }, 120);
    }
}

// First-render path: stagger the cards currently in-viewport; others reveal
// instantly when scrolled to (no stale delay).
function stagedRevealCards() {
    const cards = document.querySelectorAll('.card:not(.revealed)');
    let staggerIndex = 0;
    cards.forEach((card) => {
        const inner = card.querySelector('.card-inner');
        if (inner) {
            const rect = card.getBoundingClientRect();
            const inView = rect.top < window.innerHeight && rect.bottom > 0;
            inner.style.transitionDelay = inView ? `${Math.min(staggerIndex++ * 22, 180)}ms` : '0ms';
        }
        revealObserver.observe(card);
    });
    markLoadedImages();
}

// Cached images sometimes don't fire onload — mark complete images as loaded here.
function markLoadedImages() {
    document.querySelectorAll('.card-img').forEach(img => {
        if (img.complete && img.naturalHeight !== 0) img.classList.add('loaded');
    });
}

// --- 3. RENDERING ENGINE (With Smart Visibility) ---
function renderGrids(carsToDisplay) {
    const grids = {
        budget: document.getElementById('grid-budget'),
        collectors: document.getElementById('grid-collectors'),
        pinnacle: document.getElementById('grid-pinnacle'),
        premium: document.getElementById('grid-premium')
    };

    const sections = {
        budget: document.querySelector('.budget-tier'),
        collectors: document.querySelector('.collectors-tier'),
        pinnacle: document.querySelector('.pinnacle-tier'),
        premium: document.querySelector('.premium-tier')
    };

    const dividers = document.querySelectorAll('.section-divider');
    const buckets = { budget: [], collectors: [], pinnacle: [], premium: [] };

    Object.values(sections).forEach(s => { if(s) s.style.display = 'none'; });
    dividers.forEach(d => d.style.display = 'none');

    carsToDisplay.forEach(car => {
        const isOut = car.stock <= 0;
        const safeName = car.name.replace(/'/g, "\\'");
        const displayPrice = `RS ${car.price.toLocaleString()}`;
        const isHighEnd = (car.tier === 'gold' || car.tier === 'pinnacle' || car.tier === 'premium');
        const tiltEffect = isHighEnd ? 'data-tilt-glare="true" data-tilt-max-glare="0.5"' : '';

        const cardHTML = `
            <div class="card" data-tilt ${tiltEffect} onclick="openQuickView('${safeName}')">
                <div class="card-inner">
                    <div class="card-img-container" style="background: ${isOut ? '#111' : '#000'}">
                        <img src="${car.image}" class="card-img ${isOut ? 'sold-out' : ''}" loading="lazy" onload="this.classList.add('loaded')" onerror="this.classList.add('loaded')">
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h3>${car.name}</h3>
                        ${isHighEnd ? '<i class="fas fa-crown" style="color:inherit"></i>' : ''}
                    </div>
                    <p>${car.subtitle} ${isOut ? '<span style="color:red">[SOLD OUT]</span>' : `[${car.stock} LEFT]`}</p>
                    <button class="buy-btn" onclick="event.stopPropagation(); addToCart('${safeName}', ${car.price}, this)" ${isOut ? 'disabled' : ''}>
                        <span>ADD</span> <span>${displayPrice}</span>
                    </button>
                </div>
            </div>`;

        if (car.tier === 'sakura' || car.tier === 'budget') buckets.budget.push(cardHTML);
        else if (car.tier === 'gold' || car.tier === 'pinnacle') buckets.pinnacle.push(cardHTML);
        else if (car.tier === 'premium') buckets.premium.push(cardHTML);
        else buckets.collectors.push(cardHTML);
    });

    // One innerHTML write per grid (vs append in loop)
    const counts = {};
    for (const key of ['budget', 'collectors', 'pinnacle', 'premium']) {
        if (grids[key]) grids[key].innerHTML = buckets[key].join('');
        counts[key] = buckets[key].length;
    }

    // Visibility Logic: Only show sections and dividers if they have cars
    if (counts.budget > 0) sections.budget.style.display = 'block';
    if (counts.collectors > 0) sections.collectors.style.display = 'block';
    if (counts.pinnacle > 0) sections.pinnacle.style.display = 'block';
    if (counts.premium > 0) sections.premium.style.display = 'block';

    if (counts.budget > 0 || counts.collectors > 0 || counts.pinnacle > 0) dividers[0].style.display = 'block';
    if (counts.premium > 0) dividers[1].style.display = 'block';

    // Refresh Tilt Effects
    if (typeof VanillaTilt !== 'undefined') {
        VanillaTilt.init(document.querySelectorAll(".card"), {
            max: 5, speed: 1000, glare: true, "max-glare": 0.1, scale: 1.02
        });
    }
}

// FEATURE 4: SEARCH AUTOCOMPLETE
const searchBar = document.getElementById('search-bar');
const suggestionsBox = document.getElementById('suggestions-box');

const handleSearchInput = debounce(() => {
    const val = searchBar.value.toLowerCase();
    if (val.length < 2) { suggestionsBox.style.display = 'none'; return; }

    const matches = allCars.filter(c => c.name.toLowerCase().includes(val)).slice(0, 6);

    if (matches.length > 0) {
        suggestionsBox.innerHTML = matches.map(m => `
            <div class="suggestion-item" onclick="applySuggestion('${m.name.replace(/'/g, "\\'")}')">
                ${m.name} <small style="color:#666; float:right;">${m.subtitle.split(' / ')[0]}</small>
            </div>
        `).join('');
        suggestionsBox.style.display = 'block';
    } else {
        suggestionsBox.style.display = 'none';
    }
}, 150);

searchBar.addEventListener('input', handleSearchInput);

function applySuggestion(name) {
    searchBar.value = name;
    suggestionsBox.style.display = 'none';
    processAndRender();
}

// FEATURE 6: QUICK VIEW MODAL
function openQuickView(name) {
    const car = allCars.find(c => c.name === name);
    if (!car) return;

    document.getElementById('modal-img').src = car.image;
    document.getElementById('modal-name').innerText = car.name;
    document.getElementById('modal-subtitle').innerText = car.subtitle;
    document.getElementById('modal-price').innerText = `RS ${car.price.toLocaleString()}`;
    document.getElementById('modal-stock').innerText = car.stock > 0 ? `${car.stock} UNITS REMAINING` : "OUT OF STOCK";

    const buyBtn = document.getElementById('modal-buy-btn');
    buyBtn.onclick = (e) => addToCart(name.replace(/'/g, "\\'"), car.price, e.currentTarget);
    buyBtn.disabled = car.stock <= 0;
    buyBtn.innerText = car.stock > 0 ? "ADD TO GARAGE" : "SOLD OUT";

    const modal = document.getElementById('quick-view');
    modal.style.display = 'block';
    requestAnimationFrame(() => modal.classList.add('active'));
}

function closeQuickView() {
    const modal = document.getElementById('quick-view');
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 280);
}

document.querySelector('.close-modal').onclick = closeQuickView;
window.addEventListener('click', (event) => {
    if (event.target === document.getElementById('quick-view')) closeQuickView();
});
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('quick-view').classList.contains('active')) closeQuickView();
});

// --- 4. CART SYSTEM ---
function addToCart(name, price, originEl) {
    const item = cart.find(i => i.name === name);
    item ? item.quantity++ : cart.push({ name, price, quantity: 1 });
    localStorage.setItem('jdm_cart', JSON.stringify(cart));
    updateCartUI();

    // Micro-animations: pulse the cart count + floating "+1" from click origin
    const count = document.getElementById('cart-count');
    if (count) {
        count.classList.remove('pulse');
        void count.offsetWidth;
        count.classList.add('pulse');
    }
    if (originEl) {
        const rect = originEl.getBoundingClientRect();
        const floater = document.createElement('div');
        floater.className = 'cart-floater';
        floater.textContent = '+1';
        floater.style.left = (rect.left + rect.width / 2) + 'px';
        floater.style.top = rect.top + 'px';
        document.body.appendChild(floater);
        setTimeout(() => floater.remove(), 900);
    }
}

function removeFromCart(name) {
    cart = cart.filter(i => i.name !== name);
    localStorage.setItem('jdm_cart', JSON.stringify(cart));
    updateCartUI();
}

function updateCartUI() {
    const count = document.getElementById('cart-count');
    const list = document.getElementById('cart-items');
    const totalSpan = document.getElementById('cart-total');
    if (!count || !list) return;

    count.innerText = cart.reduce((sum, i) => sum + i.quantity, 0);
    let total = 0;

    list.innerHTML = cart.map(item => {
        total += (item.price * item.quantity);
        const safeName = item.name.replace(/'/g, "\\'");
        return `
            <li style="margin-bottom:12px; border-bottom:1px solid #222; padding-bottom:8px; display:flex; justify-content:space-between;">
                <div>${item.name}<br><small style="color:#888">Qty: ${item.quantity}</small></div>
                <div style="text-align:right">
                    <b>RS ${(item.price * item.quantity).toLocaleString()}</b><br>
                    <i class="fas fa-trash" onclick="removeFromCart('${safeName}')" style="color:red; cursor:pointer; font-size:0.8rem;"></i>
                </div>
            </li>`;
    }).join('');
    totalSpan.innerText = total.toLocaleString();
}

// --- 5. EVENT LISTENERS ---
document.getElementById('price-slider').addEventListener('input', (e) => {
    document.getElementById('price-val').innerText = parseInt(e.target.value).toLocaleString();
    processAndRender();
});

document.getElementById('sort-price').addEventListener('change', processAndRender);
document.getElementById('brand-filter').addEventListener('change', processAndRender);
document.getElementById('stock-toggle').addEventListener('change', processAndRender);

// Load More Pagination
document.getElementById('load-more-btn').addEventListener('click', () => {
    displayLimit += 12; // Load 12 more cars each click
    processAndRender();
});

// Tier Filter Buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        displayLimit = 12; // Reset pagination when switching tiers
        processAndRender();
    });
});

// Toggle Cart Panel
document.getElementById('cart-btn').onclick = () => {
    const panel = document.getElementById('cart-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
};

// Startup Sequence
document.addEventListener('DOMContentLoaded', () => {
    loadInventory();
    watchRevealables();
});