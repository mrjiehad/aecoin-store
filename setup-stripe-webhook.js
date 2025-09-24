// Stripe Webhook Setup for Localhost Development
// This script helps configure Stripe webhook for local development

console.log('🔧 Stripe Webhook Setup for Localhost Development');
console.log('================================================\n');

console.log('📋 Step-by-Step Setup Instructions:');
console.log('');

console.log('1️⃣ Install Stripe CLI (if not already installed):');
console.log('   Windows: Download from https://github.com/stripe/stripe-cli/releases');
console.log('   Or use: winget install stripe.stripe-cli');
console.log('');

console.log('2️⃣ Login to Stripe CLI:');
console.log('   stripe login');
console.log('');

console.log('3️⃣ Start webhook forwarding (run this in a separate terminal):');
console.log('   stripe listen --forward-to localhost:3000/api/webhook/stripe');
console.log('');

console.log('4️⃣ Copy the webhook signing secret from the CLI output');
console.log('   It will look like: whsec_1234567890abcdef...');
console.log('');

console.log('5️⃣ Update your .dev.vars file with the webhook secret:');
console.log('   STRIPE_WEBHOOK_SECRET=whsec_your_actual_secret_here');
console.log('');

console.log('6️⃣ Restart your development server:');
console.log('   npm run dev:sandbox');
console.log('');

console.log('🎯 What this does:');
console.log('   - Stripe CLI creates a tunnel from Stripe servers to your localhost');
console.log('   - When payments are completed, Stripe sends webhook to your local server');
console.log('   - Your webhook handler processes the payment and creates FiveM codes');
console.log('   - Orders automatically change from "pending" to "paid"');
console.log('');

console.log('🧪 Test the setup:');
console.log('   1. Make a test purchase on your localhost store');
console.log('   2. Check the Stripe CLI terminal for webhook events');
console.log('   3. Check your server logs for "ak4y_code_created" events');
console.log('   4. Verify the code appears in your FiveM database');
console.log('');

console.log('⚠️  Important Notes:');
console.log('   - Keep the Stripe CLI running while testing');
console.log('   - Use Stripe test mode (test keys) for development');
console.log('   - Webhook secret changes each time you restart stripe listen');
console.log('   - For production, you\'ll need a public URL (ngrok, etc.)');
console.log('');

console.log('🚀 Ready to start? Run the stripe listen command above!');


