import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

// Load environment variables
dotenv.config();

// Setup Express
const app = express();
const PORT = process.env.PORT || 3000;
const SERVICE_NAME = process.env.SERVICE_NAME || 'test_app';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;

// Get current file directory (ESM equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database simulation - store orders in a JSON file
const DB_PATH = path.join(__dirname, 'orders.json');

// Initialize orders.json if it doesn't exist
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({ orders: [] }, null, 2));
}

// Read orders from "database"
function getOrders() {
  const data = fs.readFileSync(DB_PATH, 'utf8');
  return JSON.parse(data);
}

// Write orders to "database"
function saveOrders(orders) {
  fs.writeFileSync(DB_PATH, JSON.stringify(orders, null, 2));
}

// Create a new order
function createOrder(amount, customer) {
  const orders = getOrders();
  const order_id = uuidv4();
  
  const newOrder = {
    id: order_id,
    amount,
    customer,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  orders.orders.push(newOrder);
  saveOrders(orders);
  return newOrder;
}

// Update order status
function updateOrderStatus(orderId, status, paymentRef) {
  const orders = getOrders();
  const order = orders.orders.find(o => o.id === orderId);
  
  if (order) {
    order.status = status;
    order.payment_reference = paymentRef;
    order.updated_at = new Date().toISOString();
    saveOrders(orders);
    return true;
  }
  return false;
}

// Configure middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Setup template engine
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.get('/', (req, res) => {
  // Show homepage with form to create an order
  res.render('index', { 
    title: 'MGPay Test App',
    orders: getOrders().orders.slice(0, 10)  // Show latest 10 orders
  });
});

// Create new order and redirect to payment 
app.post('/order', async (req, res) => {
  try {
    const { amount, customer } = req.body;
    
    // Validate input
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.render('error', { message: 'Invalid amount' });
    }
    
    if (!customer || customer.trim() === '') {
      return res.render('error', { message: 'Customer name is required' });
    }
    
    // Create order in our "database"
    const order = createOrder(Number(amount), customer);
    
    // For demo purposes, show payment options page
    res.render('payment', { order });
  } catch (error) {
    console.error('Error creating order:', error);
    res.render('error', { message: 'Failed to create order' });
  }
});

// Generate real Paystack payment link
app.post('/pay/paystack', async (req, res) => {
  try {
    const { orderId, amount, customer } = req.body;
    const email = req.body.email || 'customer@example.com';
    
    // Create a customer email if not provided
    const customerEmail = email.includes('@') ? email : `${customer.replace(/\s+/g, '').toLowerCase()}@example.com`;
    
    // Real integration with Paystack API
    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    
    if (!PAYSTACK_SECRET_KEY) {
      throw new Error('Paystack secret key is not configured');
    }
    
    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      amount: Math.round(amount * 100), // Convert to pesewas and ensure it's an integer
      email: customerEmail,
      metadata: {
        service: SERVICE_NAME, // This is crucial for MGPay webhook routing! Must match services.config.json exactly!
        order_id: orderId,
        customer
      },
      callback_url: `${req.protocol}://${req.get('host')}/order/${orderId}`, // Redirect back to order page after payment
      // Note: Ensure Paystack is configured to send webhooks to: 
      // https://pay.mediageneral.digital/webhook?provider=paystack
    }, {
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.data.status) {
      throw new Error(`Paystack error: ${response.data.message}`);
    }
    
    // Save the Paystack reference to our order
    updateOrderStatus(orderId, 'payment_initiated', response.data.data.reference);
    
    // Log the payment initialization
    console.log(`Payment initiated for order ${orderId} with reference ${response.data.data.reference}`);
    
    // Redirect to Paystack's payment page
    res.redirect(response.data.data.authorization_url);
  } catch (error) {
    console.error('Error initiating payment:', error);
    res.render('error', { message: `Failed to initiate payment: ${error.message}` });
  }
});

// Simulate a payment form for demo purposes
app.get('/simulate-payment-form', (req, res) => {
  const { provider, order_id } = req.query;
  const orders = getOrders();
  const order = orders.orders.find(o => o.id === order_id);
  
  if (!order) {
    return res.render('error', { message: 'Order not found' });
  }
  
  res.render('simulate-payment', { 
    provider, 
    order,
    mgpayWebhookUrl: 'https://pay.mediageneral.digital/webhook?provider=paystack'
  });
});

// Process simulated payment completion
app.post('/simulate-complete-payment', (req, res) => {
  const { order_id, provider } = req.body;
  const orders = getOrders();
  const order = orders.orders.find(o => o.id === order_id);
  
  if (!order) {
    return res.render('error', { message: 'Order not found' });
  }
  
  // Update order status to "processing" - in a real app, 
  // the final status update would come from MGPay webhook
  updateOrderStatus(order_id, 'processing', order.payment_reference);
  
  // Explain that in a real implementation, the provider would call MGPay's webhook endpoint
  res.render('payment-complete', { 
    order,
    provider,
    mgpayWebhookUrl: 'https://pay.mediageneral.digital/webhook?provider=paystack'
  });
});

// MGPay webhook endpoint - this is where MGPay will send payment notifications
app.post('/webhook', (req, res) => {
  console.log('======== WEBHOOK RECEIVED ========');
  console.log('Received webhook:', JSON.stringify(req.body, null, 2));
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Expected token:', SERVICE_TOKEN);
  console.log('===================================');
  
  // Verify authorization header from MGPay, but log and continue even if it doesn't match
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.log('Missing authorization header');
    // For now, we'll accept the webhook anyway to debug the flow
    // return res.status(401).json({ error: 'Unauthorized - Missing Header' });
  } else if (authHeader !== `Bearer ${SERVICE_TOKEN}`) {
    console.log(`Authorization token mismatch. Got: ${authHeader}, Expected: Bearer ${SERVICE_TOKEN}`);
    // For now, we'll accept the webhook anyway to debug the flow
    // return res.status(401).json({ error: 'Unauthorized - Token Mismatch' });
  }
  
  try {
    // Extract data from the webhook payload
    const event = req.body.event;
    const data = req.body.data;
    
    // Check that this is a payment success webhook
    if (event === 'charge.success' || event === 'payment.successful') {
      // Extract the order ID from metadata
      const orderId = data.metadata?.order_id;
      
      if (orderId) {
        // Update the order status to 'completed'
        updateOrderStatus(orderId, 'completed', data.reference);
        console.log(`Order ${orderId} marked as completed`);
      } else {
        console.log('No order ID found in webhook metadata');
      }
    }
    
    // Always respond with 200 OK to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    // Still return 200 to acknowledge receipt, even if processing failed
    res.status(200).json({ received: true, processed: false });
  }
});

// View order details
app.get('/order/:id', (req, res) => {
  const orders = getOrders();
  const order = orders.orders.find(o => o.id === req.params.id);
  
  if (!order) {
    return res.render('error', { message: 'Order not found' });
  }
  
  res.render('order-details', { order });
});

// Test webhook endpoint with a testing tool
app.get('/test-webhook', (req, res) => {
  // This page provides a form to manually test the webhook endpoint
  const orders = getOrders();
  res.render('test-webhook', { 
    orders: orders.orders,
    service_name: SERVICE_NAME,
    service_token: SERVICE_TOKEN
  });
});

// Debug endpoint to check if app is reachable
app.get('/debug', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service_name: SERVICE_NAME,
    environment: {
      port: PORT,
      service_token_configured: !!SERVICE_TOKEN,
      paystack_keys_configured: !!(process.env.PAYSTACK_PUBLIC_KEY && process.env.PAYSTACK_SECRET_KEY)
    }
  });
});

// GET handler for webhook to test accessibility (MGPay will use POST)
app.get('/webhook', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'The webhook endpoint is accessible. Please use POST method for actual webhooks.',
    timestamp: new Date().toISOString(),
    service_name: SERVICE_NAME
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`MGPay Test App running on http://localhost:${PORT}`);
  console.log(`Webhook endpoint for MGPay: https://mgpay-d7z2.onrender.com/webhook`);
  console.log(`Debug endpoint: https://mgpay-d7z2.onrender.com/debug`);
});