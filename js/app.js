import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocs, writeBatch, Timestamp, FieldValue } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Set Firebase debug logs
setLogLevel('debug');

const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

let db, auth;
let userId = null;
let products = [];
let salesHistory = [];
let currentSale = JSON.parse(localStorage.getItem('currentSale')) || [];

// UI references
const $ = id => document.getElementById(id);
const productsTableBody = $('productsTableBody');
const availableProductsTableBody = $('availableProductsTableBody');
const currentSaleTableBody = $('currentSaleTableBody');
const historyTableBody = $('historyTableBody');
const reportsTableBody = $('reportsTableBody');
const categoryFilter = $('categoryFilter');
const productNameInput = $('productName'); // Referencia añadida

// Chart instances
let weeklyProfitChart = null;
let categoryStockChart = null;

// UI Utility functions
function formatCurrency(amount) {
    return `$${parseFloat(amount).toFixed(2)}`;
}

function showToast(message, type = 'success') {
    const toast = $('toast');
    const toastMessage = $('toastMessage');
    toastMessage.textContent = message;
    toast.className = `fixed top-5 right-5 py-2 px-4 rounded-lg shadow-lg transform transition-transform duration-500 ease-in-out ${type === 'success' ? 'bg-green-500' : 'bg-red-500'} translate-x-0`;
    setTimeout(() => {
        toast.classList.add('translate-x-[120%]');
    }, 3000);
}

// Admin Modal Logic
let adminActionCallback = null;
const adminModal = $('adminModal');
const adminPasswordInput = $('adminPasswordInput');
const adminForm = $('adminForm');
const adminPassword = 'losmarmotas123';

function promptForPassword(callback) {
    adminActionCallback = callback;
    adminPasswordInput.value = '';
    adminModal.classList.remove('hidden');
    adminModal.classList.add('flex');
}

adminForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (adminPasswordInput.value === adminPassword) {
        adminModal.classList.remove('flex');
        adminModal.classList.add('hidden');
        if (adminActionCallback) {
            adminActionCallback();
            adminActionCallback = null;
        }
    } else {
        showToast('Contraseña incorrecta.', 'error');
    }
});

$('cancelAdminBtn').addEventListener('click', () => {
    adminModal.classList.remove('flex');
    adminModal.classList.add('hidden');
    adminActionCallback = null;
});

// Firestore and Auth Initialization
async function initializeFirebase() {
    try {
        const app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                $('userIdDisplay').textContent = `ID de Usuario: ${userId}`;
                setupListeners();
                renderAll();
            } else {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }
            }
        });
    } catch (error) {
        console.error("Error initializing Firebase:", error);
        showToast("Error de inicialización de Firebase.", "error");
    }
}

// Firestore Real-time Listeners
function setupListeners() {
    if (!userId) return;

    const productsCol = collection(db, `artifacts/${appId}/users/${userId}/products`);
    const salesCol = collection(db, `artifacts/${appId}/users/${userId}/sales`);

    onSnapshot(productsCol, (snapshot) => {
        products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderProductsTable();
        renderAvailableProductsTable();
        renderDashboard();
        renderBalanceCharts();
        populateCategoryFilter();
    }, (error) => {
        console.error("Error fetching products:", error);
        showToast("Error al cargar productos.", "error");
    });

    onSnapshot(salesCol, (snapshot) => {
        salesHistory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderDashboard();
        renderReportsTable();
        renderHistoryTable();
    }, (error) => {
        console.error("Error fetching sales history:", error);
        showToast("Error al cargar historial de ventas.", "error");
    });
}

// Data Management Functions (CRUD)
async function addProduct(product) {
    try {
        const docRef = await addDoc(collection(db, `artifacts/${appId}/users/${userId}/products`), product);
        showToast('Producto agregado con éxito.');
    } catch (error) {
        console.error("Error adding product:", error);
        showToast("Error al agregar producto.", "error");
    }
}

async function updateProduct(id, product) {
    try {
        await setDoc(doc(db, `artifacts/${appId}/users/${userId}/products`, id), product);
        showToast('Producto actualizado con éxito.');
    } catch (error) {
        console.error("Error updating product:", error);
        showToast("Error al actualizar producto.", "error");
    }
}

async function deleteProduct(id) {
    try {
        await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/products`, id));
        showToast('Producto eliminado con éxito.');
    } catch (error) {
        console.error("Error deleting product:", error);
        showToast("Error al eliminar producto.", "error");
    }
}

async function confirmSale() {
    if (currentSale.length === 0) {
        showToast('La venta está vacía.', 'error');
        return;
    }
    const saleTotal = currentSale.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const saleProfit = currentSale.reduce((sum, item) => sum + (item.quantity * (item.price - item.cost)), 0);
    const paymentMethod = $('salePaymentMethod').value;
    
    const newSale = {
        items: currentSale,
        total: saleTotal,
        profit: saleProfit,
        paymentMethod: paymentMethod,
        date: Timestamp.now()
    };

    const batch = writeBatch(db);
    const productsCol = collection(db, `artifacts/${appId}/users/${userId}/products`);

    for (const item of currentSale) {
        const productRef = doc(productsCol, item.id);
        batch.update(productRef, {
            stock: FieldValue.increment(-item.quantity)
        });
    }

    try {
        await batch.commit();
        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/sales`), newSale);
        currentSale = [];
        localStorage.setItem('currentSale', JSON.stringify(currentSale));
        renderCurrentSale();
        showToast('Venta confirmada y registrada.');
    } catch (error) {
        console.error("Error confirming sale:", error);
        showToast("Error al confirmar la venta.", "error");
    }
}

async function resetDailySales() {
    try {
        const salesCol = collection(db, `artifacts/${appId}/users/${userId}/sales`);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const startOfToday = Timestamp.fromDate(today);

        const q = query(salesCol, where("date", ">=", startOfToday));
        const snapshot = await getDocs(q);
        
        if (snapshot.docs.length === 0) {
            showToast('No hay ventas hoy para reiniciar.', 'error');
            return;
        }

        const batch = writeBatch(db);
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        showToast('Ventas del día reiniciadas con éxito.');
    } catch (error) {
        console.error("Error resetting sales:", error);
        showToast("Error al reiniciar las ventas del día.", "error");
    }
}


// UI Render Functions
function renderAll() {
    renderDashboard();
    renderProductsTable();
    renderAvailableProductsTable();
    renderCurrentSale();
    renderReportsTable();
    renderBalanceCharts();
    renderHistoryTable();
    populateCategoryFilter();
}

function switchSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.add('hidden');
    });
    document.querySelectorAll('.nav-item').forEach(link => {
        link.classList.remove('nav-item-active');
    });

    const activeSection = document.querySelector(sectionId);
    if (activeSection) {
        activeSection.classList.remove('hidden');
    }
    const activeLink = document.querySelector(`a[href="${sectionId}"]`);
    if (activeLink) {
        activeLink.classList.add('nav-item-active');
    }
}

function populateCategoryFilter() {
    const categories = [...new Set(products.map(p => p.category))];
    categoryFilter.innerHTML = '<option value="">Todas las categorías</option>';
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categoryFilter.appendChild(option);
    });
}

function renderProductsTable() {
    const searchText = $('productSearch').value.toLowerCase();
    const category = $('categoryFilter').value;
    
    const filteredProducts = products.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchText);
        const matchesCategory = category === '' || p.category === category;
        return matchesSearch && matchesCategory;
    });

    productsTableBody.innerHTML = '';
    filteredProducts.forEach(product => {
        const row = document.createElement('tr');
        row.className = 'border-b border-purple-500/10 hover:bg-gray-800/20 transition-colors';
        row.innerHTML = `
            <td class="p-4">${product.name}</td>
            <td class="p-4">${product.category}</td>
            <td class="p-4 text-center">${product.stock}</td>
            <td class="p-4">${formatCurrency(product.cost)}</td>
            <td class="p-4">${formatCurrency(product.price)}</td>
            <td class="p-4">
                <button onclick="editProduct('${product.id}')" class="text-blue-400 hover:text-blue-600 mr-2"><i class="fas fa-edit"></i></button>
                <button onclick="promptForPassword(() => deleteProduct('${product.id}'))" class="text-red-400 hover:text-red-600"><i class="fas fa-trash"></i></button>
            </td>
        `;
        productsTableBody.appendChild(row);
    });
}

function renderAvailableProductsTable() {
    const searchText = $('saleProductSearch').value.toLowerCase();
    const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchText) && p.stock > 0);
    
    availableProductsTableBody.innerHTML = '';
    filteredProducts.forEach(product => {
        const row = document.createElement('tr');
        row.className = 'border-b border-purple-500/10 hover:bg-gray-800/20 transition-colors';
        row.innerHTML = `
            <td class="p-4 flex items-center">
                ${product.image ? `<img src="${product.image}" onerror="this.onerror=null;this.src='https://placehold.co/40x40/5b21b6/fff?text=GS'" class="h-10 w-10 rounded-full mr-2" alt="${product.name}">` : ''}
                <span>${product.name}</span>
            </td>
            <td class="p-4 text-center">${product.stock}</td>
            <td class="p-4 text-center">${formatCurrency(product.price)}</td>
            <td class="p-4 text-center">
                <button onclick="addToSale('${product.id}')" class="bg-green-600 hover:bg-green-700 text-white w-8 h-8 rounded-full"><i class="fas fa-plus"></i></button>
            </td>
        `;
        availableProductsTableBody.appendChild(row);
    });
}

function renderCurrentSale() {
    currentSaleTableBody.innerHTML = '';
    let total = 0;
    currentSale.forEach(item => {
        const product = products.find(p => p.id === item.id);
        if (!product) return;
        const subtotal = item.quantity * product.price;
        total += subtotal;
        const row = document.createElement('tr');
        row.className = 'border-b border-purple-500/10 hover:bg-gray-800/20 transition-colors';
        row.innerHTML = `
            <td class="p-4">${product.name}</td>
            <td class="p-4 text-center">${item.quantity}</td>
            <td class="p-4 text-center">${formatCurrency(product.price)}</td>
            <td class="p-4 text-right">${formatCurrency(subtotal)}</td>
            <td class="p-4">
                <button onclick="removeFromSale('${item.id}')" class="text-red-400 hover:text-red-600"><i class="fas fa-times"></i></button>
            </td>
        `;
        currentSaleTableBody.appendChild(row);
    });
    $('saleTotal').textContent = formatCurrency(total);
}

function renderDashboard() {
    const today = new Date();
    today.setHours(0,0,0,0);
    const startOfToday = Timestamp.fromDate(today);

    const salesToday = salesHistory.filter(sale => sale.date && sale.date.seconds * 1000 >= startOfToday.seconds * 1000);
    const totalSalesToday = salesToday.reduce((sum, sale) => sum + sale.total, 0);
    const totalProfitToday = salesToday.reduce((sum, sale) => sum + sale.profit, 0);

    const startOfWeek = new Date();
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0,0,0,0);
    const startOfThisWeek = Timestamp.fromDate(startOfWeek);

    const weeklyProfits = Array(7).fill(0);
    const last7DaysLabels = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startOfWeek);
        d.setDate(d.getDate() + i);
        return d.toLocaleDateString('es-ES', { weekday: 'short' });
    });

    salesHistory.forEach(sale => {
        if (sale.date && sale.date.seconds * 1000 >= startOfThisWeek.seconds * 1000) {
            const saleDay = new Date(sale.date.seconds * 1000).getDay();
            weeklyProfits[saleDay] += sale.profit;
        }
    });

    const totalProfitWeek = weeklyProfits.reduce((sum, profit) => sum + profit, 0);
    const totalProfitMonth = salesHistory.filter(sale => {
        const saleDate = new Date(sale.date.seconds * 1000);
        const now = new Date();
        return saleDate.getMonth() === now.getMonth() && saleDate.getFullYear() === now.getFullYear();
    }).reduce((sum, sale) => sum + sale.profit, 0);

    $('salesToday').textContent = formatCurrency(totalSalesToday);
    $('profitToday').textContent = formatCurrency(totalProfitToday);
    $('profitWeek').textContent = formatCurrency(totalProfitWeek);
    $('profitMonth').textContent = formatCurrency(totalProfitMonth);

    if (weeklyProfitChart) { weeklyProfitChart.destroy(); }
    const ctx = $('weeklyProfitChart').getContext('2d');
    weeklyProfitChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: last7DaysLabels,
            datasets: [{
                label: 'Ganancia Semanal',
                data: weeklyProfits,
                backgroundColor: '#9333ea',
                borderColor: '#c084fc',
                borderWidth: 1,
                borderRadius: 6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    ticks: { color: '#e2e8f0' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#e2e8f0' }
                }
            },
            plugins: {
                legend: { labels: { color: '#e2e8f0' } }
            }
        }
    });

    const criticalStockList = $('criticalStock');
    criticalStockList.innerHTML = '';
    const criticalProducts = products.filter(p => p.stock < 5);
    if (criticalProducts.length === 0) {
        criticalStockList.innerHTML = '<p class="text-gray-400">No hay productos con stock crítico.</p>';
    } else {
        criticalProducts.forEach(product => {
            const div = document.createElement('div');
            div.className = 'glass-card p-4 flex justify-between items-center';
            div.innerHTML = `
                <span>${product.name}</span>
                <span class="text-red-400 font-bold">${product.stock} unidades</span>
            `;
            criticalStockList.appendChild(div);
        });
    }
}

function renderReportsTable() {
    const reports = {};
    salesHistory.forEach(sale => {
        sale.items.forEach(item => {
            if (!reports[item.id]) {
                reports[item.id] = {
                    name: item.name,
                    unitsSold: 0,
                    totalSales: 0,
                    totalProfit: 0,
                };
            }
            reports[item.id].unitsSold += item.quantity;
            reports[item.id].totalSales += item.price * item.quantity;
            reports[item.id].totalProfit += (item.price - item.cost) * item.quantity;
        });
    });

    reportsTableBody.innerHTML = '';
    for (const productId in reports) {
        const report = reports[productId];
        const row = document.createElement('tr');
        row.className = 'border-b border-purple-500/10 hover:bg-gray-800/20 transition-colors';
        row.innerHTML = `
            <td class="p-4">${report.name}</td>
            <td class="p-4 text-center">${report.unitsSold}</td>
            <td class="p-4">${formatCurrency(report.totalSales)}</td>
            <td class="p-4">${formatCurrency(report.totalProfit)}</td>
        `;
        reportsTableBody.appendChild(row);
    }
}

function renderBalanceCharts() {
    const categoryStock = {};
    let totalStock = 0;
    products.forEach(p => {
        if (!categoryStock[p.category]) {
            categoryStock[p.category] = 0;
        }
        categoryStock[p.category] += p.stock;
        totalStock += p.stock;
    });
    
    const categoryBalanceDiv = $('categoryBalance');
    categoryBalanceDiv.innerHTML = '';
    for (const category in categoryStock) {
        const percentage = totalStock > 0 ? (categoryStock[category] / totalStock * 100).toFixed(1) : 0;
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center glass-card p-4';
        div.innerHTML = `
            <h3 class="text-lg font-semibold">${category}</h3>
            <div class="flex items-center gap-2">
                <span class="text-lg text-purple-400 font-bold">${categoryStock[category]} unidades</span>
                <span class="text-sm text-gray-400">(${percentage}%)</span>
            </div>
        `;
        categoryBalanceDiv.appendChild(div);
    }

    if (categoryStockChart) { categoryStockChart.destroy(); }
    const ctx = $('categoryStockChart').getContext('2d');
    const categoryLabels = Object.keys(categoryStock);
    const categoryData = Object.values(categoryStock);
    categoryStockChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: categoryLabels,
            datasets: [{
                data: categoryData,
                backgroundColor: [
                    '#9333ea', '#c084fc', '#e879f9', '#f0abfc', '#a78bfa', '#6d28d9', '#5b21b6'
                ],
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#e2e8f0'
                    }
                }
            }
        }
    });
}

function renderHistoryTable() {
    historyTableBody.innerHTML = '';
    salesHistory.forEach(sale => {
        const row = document.createElement('tr');
        row.className = 'border-b border-purple-500/10 hover:bg-gray-800/20 transition-colors';
        const saleDate = new Date(sale.date.seconds * 1000).toLocaleString('es-ES');
        row.innerHTML = `
            <td class="p-4">${sale.id.slice(0, 8)}...</td>
            <td class="p-4">${saleDate}</td>
            <td class="p-4">${formatCurrency(sale.total)}</td>
            <td class="p-4">${formatCurrency(sale.profit)}</td>
            <td class="p-4">${sale.paymentMethod}</td>
            <td class="p-4">
                <button onclick="viewSaleDetails('${sale.id}')" class="text-blue-400 hover:text-blue-600"><i class="fas fa-eye"></i></button>
            </td>
        `;
        historyTableBody.appendChild(row);
    });
}

// Event Handlers
$('addProductBtn').addEventListener('click', () => {
    $('modalTitle').textContent = 'Agregar Producto';
    $('productId').value = '';
    productForm.reset();
    productModal.classList.remove('hidden');
    productModal.classList.add('flex');
});

$('cancelProductBtn').addEventListener('click', () => {
    productModal.classList.remove('flex');
    productModal.classList.add('hidden');
});

productForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('productId').value;
    const product = {
        name: productNameInput.value,
        category: $('productCategory').value,
        stock: parseInt($('productStock').value),
        cost: parseFloat($('productCost').value),
        price: parseFloat($('productPrice').value),
        image: $('productImage').value
    };
    if (id) {
        updateProduct(id, product);
    } else {
        addProduct(product);
    }
    productModal.classList.remove('flex');
    productModal.classList.add('hidden');
});

window.editProduct = (id) => {
    const product = products.find(p => p.id === id);
    if (product) {
        $('modalTitle').textContent = 'Editar Producto';
        $('productId').value = product.id;
        $('productName').value = product.name;
        $('productCategory').value = product.category;
        $('productStock').value = product.stock;
        $('productCost').value = product.cost;
        $('productPrice').value = product.price;
        $('productImage').value = product.image;
        productModal.classList.remove('hidden');
        productModal.classList.add('flex');
    }
};

window.addToSale = (id) => {
    const product = products.find(p => p.id === id);
    if (!product || product.stock <= 0) {
        showToast('Producto sin stock.', 'error');
        return;
    }
    const existingItem = currentSale.find(item => item.id === id);
    if (existingItem) {
        if (existingItem.quantity < product.stock) {
            existingItem.quantity++;
        } else {
            showToast('No hay más stock disponible.', 'error');
            return;
        }
    } else {
        const newSaleItem = {
            id: product.id,
            name: product.name,
            quantity: 1,
            price: product.price,
            cost: product.cost
        };
        currentSale.push(newSaleItem);
    }
    localStorage.setItem('currentSale', JSON.stringify(currentSale));
    renderCurrentSale();
    showToast('Producto agregado a la venta.');
};

window.removeFromSale = (id) => {
    currentSale = currentSale.filter(item => item.id !== id);
    localStorage.setItem('currentSale', JSON.stringify(currentSale));
    renderCurrentSale();
};

$('saleForm').addEventListener('submit', (e) => {
    e.preventDefault();
    confirmSale();
});

$('resetDailySalesBtn').addEventListener('click', () => {
    promptForPassword(() => resetDailySales());
});

$('exportCsvBtn').addEventListener('click', () => {
    const reports = {};
    salesHistory.forEach(sale => {
        sale.items.forEach(item => {
            if (!reports[item.id]) {
                reports[item.id] = {
                    name: item.name,
                    unitsSold: 0,
                    totalSales: 0,
                    totalProfit: 0,
                };
            }
            reports[item.id].unitsSold += item.quantity;
            reports[item.id].totalSales += item.price * item.quantity;
            reports[item.id].totalProfit += (item.price - item.cost) * item.quantity;
        });
    });

    let csv = 'Producto,Unidades Vendidas,Ventas Totales,Ganancia Total\n';
    for (const productId in reports) {
        const report = reports[productId];
        csv += `${report.name},${report.unitsSold},${report.totalSales.toFixed(2)},${report.totalProfit.toFixed(2)}\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'reporte_ventas.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('Reporte exportado como CSV.');
    }
});

window.viewSaleDetails = (id) => {
    const sale = salesHistory.find(s => s.id === id);
    if (sale) {
        const itemsList = sale.items.map(item => `- ${item.name} (${item.quantity} unidades) - ${formatCurrency(item.price)}`).join('\n');
        showToast(`Detalles de la Venta:\nFecha: ${new Date(sale.date.seconds * 1000).toLocaleString()}\nTotal: ${formatCurrency(sale.total)}\nGanancia: ${formatCurrency(sale.profit)}\nMétodo: ${sale.paymentMethod}\nProductos:\n${itemsList}`, 'info');
    }
};

// UI Listeners
window.addEventListener('hashchange', () => {
    const hash = window.location.hash || '#dashboard';
    switchSection(hash);
    renderAll();
});

$('productSearch').addEventListener('input', renderProductsTable);
$('categoryFilter').addEventListener('change', renderProductsTable);
$('saleProductSearch').addEventListener('input', renderAvailableProductsTable);

window.onload = () => {
    initializeFirebase();
    const hash = window.location.hash || '#dashboard';
    switchSection(hash);
};
