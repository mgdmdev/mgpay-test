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

// Generate Paystack payment link
app.post('/pay/paystack', async (req, res) => {
  try {
    const { orderId, amount, customer } = req.body;
    
    // In a real integration, you'd make a request to Paystack to create a payment link
    // For this demo app, we'll simulate it with a mock response
    
    // NOTE: In production, you would use the actual Paystack API
    // const response = await axios.post('https://api.paystack.co/transaction/initialize', {
    //   amount: amount * 100, // Convert to pesewas
    //   email: 'customer@example.com',
    //   metadata: {
    //     service: SERVICE_NAME,
    //     order_id: orderId,
    //     customer
    //   }
    // }, {
    //   headers: {
    //     'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`
    //   }
    // });
    
    // For demo purposes only - this simulates what Paystack would return
    const mockResponse = {
      status: true,
      message: 'Authorization URL created',
      data: {
        authorization_url: `/simulate-payment-form?provider=paystack&order_id=${orderId}`,
        access_code: 'ACCESS_CODE',
        reference: `ref_${orderId.substring(0, 8)}`
      }
    };
    
    // Save the Paystack reference to our order
    updateOrderStatus(orderId, 'payment_initiated', mockResponse.data.reference);
    
    // Redirect to the payment page
    res.redirect(mockResponse.data.authorization_url);
  } catch (error) {
    console.error('Error initiating payment:', error);
    res.render('error', { message: 'Failed to initiate payment' });
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
  console.log('Received webhook:', JSON.stringify(req.body, null, 2));
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  // Verify authorization header from MGPay
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${SERVICE_TOKEN}`) {
    console.log('Unauthorized webhook request');
    return res.status(401).json({ error: 'Unauthorized' });
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
    service_name: SERVICE_NAME
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`MGPay Test App running on http://localhost:${PORT}`);
  console.log(`Webhook endpoint for MGPay: http://your-public-url:${PORT}/webhook`);
});