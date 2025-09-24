// ToyyibPay Credentials Validator
// Run with: node validate-toyyibpay.js

import { ToyyibPayGateway } from './src/lib/gateway/toyyibpay.ts';

async function validateToyyibPayCredentials() {
  console.log('🔍 Validating ToyyibPay Credentials...\n');

  // Your secret key
  const secretKey = '72pw4zkj-86r9-n9mg-mnle-ssimi08h74z8';
  
  console.log('🔑 Secret Key:', secretKey);
  console.log('🌐 Using Production Environment: https://toyyibpay.com\n');

  // Initialize ToyyibPay gateway
  const toyyibpay = new ToyyibPayGateway(secretKey);

  console.log('📋 Step 1: Getting available categories...');
  try {
    const categoriesResult = await toyyibpay.getCategories();
    
    if (categoriesResult.success) {
      console.log('✅ Categories retrieved successfully!');
      console.log('📄 Available Categories:');
      console.log(JSON.stringify(categoriesResult.data, null, 2));
      
      // If categories exist, try using the first one
      if (Array.isArray(categoriesResult.data) && categoriesResult.data.length > 0) {
        const firstCategory = categoriesResult.data[0];
        const categoryCode = firstCategory.categorycode || firstCategory.CategoryCode;
        
        if (categoryCode) {
          console.log(`\n🎯 Found Category Code: ${categoryCode}`);
          console.log('💡 Update your .dev.vars file with this category code:\n');
          console.log(`TOYYIBPAY_CATEGORY_CODE=${categoryCode}\n`);
          
          // Test bill creation with the correct category
          console.log('📝 Step 2: Testing bill creation with correct category...');
          
          const toyyibpayWithCategory = new ToyyibPayGateway(secretKey, categoryCode);
          const testBill = await toyyibpayWithCategory.createBill({
            orderNumber: 'TEST-' + Date.now(),
            amount: 100, // RM 1.00 in sen
            currency: 'MYR',
            description: 'Test Payment',
            customerName: 'Test Customer',
            customerEmail: 'test@example.com',
            returnUrl: 'http://localhost:5173/success',
            callbackUrl: 'http://localhost:5173/api/webhook/toyyibpay'
          });
          
          if (testBill.success) {
            console.log('✅ Bill creation test successful!');
            console.log('🔗 Payment URL:', testBill.data.billPaymentUrl);
            console.log('\n🎉 ToyyibPay integration is working correctly!');
          } else {
            console.log('❌ Bill creation test failed:');
            console.log('Error:', testBill.error);
          }
        }
      } else {
        console.log('⚠️  No categories found. You may need to create a category in your ToyyibPay dashboard first.');
      }
      
    } else {
      console.log('❌ Failed to get categories:');
      console.log('Error:', categoriesResult.error);
      
      if (categoriesResult.error.includes('Invalid ToyyibPay credentials')) {
        console.log('\n💡 Troubleshooting Steps:');
        console.log('1. Verify your secret key is correct');
        console.log('2. Check if your ToyyibPay account is active');
        console.log('3. Ensure you\'re using the production environment');
        console.log('4. Create a category in your ToyyibPay dashboard');
      }
    }
    
  } catch (error) {
    console.error('❌ Validation error:', error);
  }
}

// Run the validation
validateToyyibPayCredentials().catch(console.error);