// Load cart from localStorage - v2.1 with enhanced debugging
console.log('🚀 Checkout.js loaded - Enhanced debugging enabled');
let cart = JSON.parse(localStorage.getItem('aecoin_cart') || '[]');
let cartTotal = 0;

// Load checkout page
async function loadCheckout() {
    if (cart.length === 0) {
        window.location.href = '/packages';
        return;
    }
    
    // Calculate cart price
    try {
        const response = await axios.post('/api/cart/price', {
            items: cart.map(item => ({
                product_id: item.product_id,
                quantity: item.quantity
            }))
        });
        
        if (response.data.success) {
            displayCheckout(response.data.data);
        } else {
            showError(response.data.error || 'Failed to calculate cart total');
        }
    } catch (error) {
        console.error('Error calculating cart:', error);
        showError('Failed to load checkout');
    }
}

// Display checkout page
function displayCheckout(cartData) {
    cartTotal = cartData.total;
    const app = document.getElementById('app');
    
    let itemsHtml = '';
    cartData.items.forEach(item => {
        itemsHtml += `
            <div class="flex justify-between py-3 border-b border-gray-700">
                <div>
                    <h4 class="font-bold">${item.product_title}</h4>
                    <p class="text-gray-400 text-sm">${item.amount_ae} AECOIN × ${item.quantity}</p>
                </div>
                <div class="text-right">
                    <p class="text-[#FFD600] font-bold">RM ${item.total.toFixed(2)}</p>
                    <p class="text-gray-400 line-through text-sm">RM ${(item.price_original * item.quantity).toFixed(2)}</p>
                </div>
            </div>
        `;
    });
    
    let html = `
        <!-- Header -->
        <header class="sticky top-0 z-50 bg-[#0D0D0D]/95 backdrop-blur-sm border-b border-[#FFD600]/20">
            <div class="container mx-auto px-4">
                <div class="flex items-center justify-between h-16">
                    <a href="/" class="flex items-center space-x-2">
                        <i class="fas fa-coins text-[#FFD600] text-2xl"></i>
                        <span class="text-xl font-bold">AECOIN STORE</span>
                    </a>
                    <nav class="hidden md:flex space-x-6">
                        <a href="/" class="hover:text-[#FFD600] transition">Home</a>
                        <a href="/packages" class="hover:text-[#FFD600] transition">Packages</a>
                        <a href="/orders" class="hover:text-[#FFD600] transition">My Orders</a>
                    </nav>
                </div>
            </div>
        </header>

        <!-- Checkout Content -->
        <div class="container mx-auto px-4 py-12 max-w-4xl">
            <h1 class="text-3xl font-bold mb-8">Checkout</h1>
            
            <div class="grid md:grid-cols-2 gap-8">
                <!-- Order Summary -->
                <div class="bg-[#1A1A1A] rounded-lg p-6">
                    <h2 class="text-xl font-bold mb-4">Order Summary</h2>
                    ${itemsHtml}
                    <div class="flex justify-between pt-4">
                        <span class="text-xl font-bold">Total:</span>
                        <span class="text-2xl font-bold text-[#FFD600]">RM ${cartTotal.toFixed(2)}</span>
                    </div>
                </div>
                
                <!-- Checkout Form -->
                <div class="bg-[#1A1A1A] rounded-lg p-6">
                    <h2 class="text-xl font-bold mb-4">Payment Details</h2>
                    <form id="checkout-form">
                        <div class="mb-6">
                            <label class="block text-sm font-medium mb-2">Email Address</label>
                            <input type="email" 
                                   id="email" 
                                   required
                                   placeholder="your@email.com"
                                   class="w-full bg-[#0D0D0D] border border-gray-700 rounded-lg px-4 py-3 focus:border-[#FFD600] focus:outline-none">
                            <p class="text-xs text-gray-400 mt-1">We'll send your codes to this email</p>
                        </div>
                        
                        <div class="mb-6">
                            <label class="block text-sm font-medium mb-2">Phone Number (Required for Malaysian Payment)</label>
                            <input type="tel" 
                                   id="phone" 
                                   required
                                   placeholder="0123456789"
                                   pattern="[0-9]{10,11}"
                                   class="w-full bg-[#0D0D0D] border border-gray-700 rounded-lg px-4 py-3 focus:border-[#FFD600] focus:outline-none">
                            <p class="text-xs text-gray-400 mt-1">Malaysian phone number (e.g., 0123456789)</p>
                        </div>
                        
                        <!-- Payment Method Selection -->
                        <div class="mb-6">
                            <label class="block text-sm font-medium mb-3">Payment Method</label>
                            <div class="space-y-3">
                                <!-- Stripe Option -->
                                <div class="payment-option">
                                    <input type="radio" name="payment_method" value="stripe" id="payment_stripe" 
                                           class="sr-only peer" checked>
                                    <label for="payment_stripe" 
                                           class="block p-4 bg-[#0D0D0D] border-2 border-gray-700 rounded-lg cursor-pointer 
                                                  hover:border-[#FFD600] transition-all peer-checked:border-[#FFD600] 
                                                  peer-checked:bg-[#FFD600]/10">
                                        <div class="flex items-center justify-between">
                                            <div class="flex items-center">
                                                <i class="fab fa-stripe text-purple-500 text-2xl mr-3"></i>
                                                <div>
                                                    <p class="font-bold">Stripe</p>
                                                    <p class="text-sm text-gray-400">Cards & FPX (Online Banking)</p>
                                                </div>
                                            </div>
                                            <span class="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">
                                                Recommended
                                            </span>
                                        </div>
                                    </label>
                                </div>

                                <!-- PayPal Option -->
                                <div class="payment-option">
                                    <input type="radio" name="payment_method" value="paypal" id="payment_paypal" 
                                           class="sr-only peer">
                                    <label for="payment_paypal" 
                                           class="block p-4 bg-[#0D0D0D] border-2 border-gray-700 rounded-lg cursor-pointer 
                                                  hover:border-[#FFD600] transition-all peer-checked:border-[#FFD600] 
                                                  peer-checked:bg-[#FFD600]/10">
                                        <div class="flex items-center justify-between">
                                            <div class="flex items-center">
                                                <i class="fab fa-paypal text-blue-500 text-2xl mr-3"></i>
                                                <div>
                                                    <p class="font-bold">PayPal</p>
                                                    <p class="text-sm text-gray-400">Pay with PayPal Balance or Cards</p>
                                                </div>
                                            </div>
                                            <span class="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">
                                                International
                                            </span>
                                        </div>
                                    </label>
                                </div>

                                <!-- ToyyibPay Option -->
                                <div class="payment-option">
                                    <input type="radio" name="payment_method" value="toyyibpay" id="payment_toyyibpay" 
                                           class="sr-only peer">
                                    <label for="payment_toyyibpay" 
                                           class="block p-4 bg-[#0D0D0D] border-2 border-gray-700 rounded-lg cursor-pointer 
                                                  hover:border-[#FFD600] transition-all peer-checked:border-[#FFD600] 
                                                  peer-checked:bg-[#FFD600]/10">
                                        <div class="flex items-center justify-between">
                                            <div class="flex items-center">
                                                <i class="fas fa-credit-card text-green-500 text-2xl mr-3"></i>
                                                <div>
                                                    <p class="font-bold">ToyyibPay</p>
                                                    <p class="text-sm text-gray-400">FPX, Cards & Online Banking (Malaysia)</p>
                                                </div>
                                            </div>
                                            <span class="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">
                                                Local
                                            </span>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </div>
                        

                        
                        <div class="mb-6">
                            <label class="flex items-center">
                                <input type="checkbox" id="terms" required class="mr-3">
                                <span class="text-sm">I accept the <a href="#" class="text-[#FFD600] hover:underline">terms and conditions</a></span>
                            </label>
                        </div>
                        
                        <button type="submit" 
                                id="checkout-btn"
                                class="w-full bg-[#FFD600] text-black py-3 rounded-lg font-bold hover:bg-yellow-400 transition">
                            <i class="fas fa-credit-card mr-2"></i>
                            <span id="btn-text">Pay with Stripe RM ${cartTotal.toFixed(2)}</span>
                        </button>
                    </form>
                    
                    <div class="mt-6 flex items-center justify-center space-x-4 text-gray-400 text-sm">
                        <i class="fas fa-shield-alt"></i>
                        <span>Secure Payment</span>
                        <i class="fas fa-lock"></i>
                        <span>SSL Encrypted</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    app.innerHTML = html;
    
    // Add payment method change handlers
    document.querySelectorAll('input[name="payment_method"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const selectedMethod = e.target.value;
            const btnText = document.getElementById('btn-text');
            const btn = document.getElementById('checkout-btn');
            
            if (selectedMethod === 'paypal') {
                btnText.innerHTML = `Pay with PayPal RM ${cartTotal.toFixed(2)}`;
                btn.className = 'w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition';
            } else if (selectedMethod === 'toyyibpay') {
                btnText.innerHTML = `Pay with ToyyibPay RM ${cartTotal.toFixed(2)}`;
                btn.className = 'w-full bg-green-600 text-white py-3 rounded-lg font-bold hover:bg-green-700 transition';
            } else {
                btnText.innerHTML = `Pay with Stripe RM ${cartTotal.toFixed(2)}`;
                btn.className = 'w-full bg-[#FFD600] text-black py-3 rounded-lg font-bold hover:bg-yellow-400 transition';
            }
        });
    });
    
    // Add form submission handler
    document.getElementById('checkout-form').addEventListener('submit', handleCheckout);
}

// Handle checkout submission
async function handleCheckout(e) {
    e.preventDefault();
    console.log('🚀 CHECKOUT FORM SUBMITTED - Debug v2.1');
    
    const email = document.getElementById('email').value;
    const phone = document.getElementById('phone').value;
    const terms = document.getElementById('terms').checked;
    const selectedPaymentMethod = document.querySelector('input[name="payment_method"]:checked').value;
    const btn = document.getElementById('checkout-btn');
    
    console.log('📋 Form data:', { email, phone, terms, paymentMethod: selectedPaymentMethod, cartLength: cart.length });
    
    if (!terms) {
        alert('Please accept the terms and conditions');
        return;
    }
    
    if (!phone || phone.length < 10) {
        alert('Please enter a valid Malaysian phone number');
        return;
    }
    
    // Store original button text
    const originalBtnText = btn.innerHTML;
    
    // Disable button and show loading
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';
    
    try {
        console.log('📡 Sending checkout request to /api/checkout...');
        console.log('📦 Request payload:', {
            email: email,
            phone: phone,
            items: cart.map(item => ({
                product_id: item.product_id,
                quantity: item.quantity
            })),
            terms_accepted: terms,
            payment_method: selectedPaymentMethod
        });
        
        const response = await axios.post('/api/checkout', {
            email: email,
            phone: phone,
            items: cart.map(item => ({
                product_id: item.product_id,
                quantity: item.quantity
            })),
            terms_accepted: terms,
            payment_method: selectedPaymentMethod
        });
        
        console.log('Checkout response:', response.data);
        
        if (response.data.success) {
            console.log('Success! Redirecting to:', response.data.data.payment_url);
            
            // Clear cart
            localStorage.removeItem('aecoin_cart');
            
            // Redirect to payment gateway
            window.location.href = response.data.data.payment_url;
            window.location.href = response.data.data.payment_url;
        } else {
            console.error('Checkout failed:', response.data.error);
            showError(response.data.error || 'Failed to process checkout');
            btn.disabled = false;
            btn.innerHTML = originalBtnText;
        }
    } catch (error) {
        console.error('Checkout error:', error);
        console.error('Error details:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        });
        showError('Failed to process payment. Please try again.');
        btn.disabled = false;
        btn.innerHTML = originalBtnText;
    }
}


// Show error
function showError(message) {
    alert(message); // Simple alert for now
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadCheckout();
});