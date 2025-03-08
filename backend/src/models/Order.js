import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  sku: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true
  },
  discount: {
    type: Number,
    default: 0
  },
  tax: {
    type: Number,
    default: 0
  },
  metadata: {
    type: Map,
    of: String
  }
}, { _id: true });

const shippingSchema = new mongoose.Schema({
  method: {
    type: String,
    required: true
  },
  carrier: String,
  trackingNumber: String,
  estimatedDelivery: Date,
  cost: {
    type: Number,
    required: true
  },
  address: {
    street: {
      type: String,
      required: true
    },
    city: {
      type: String,
      required: true
    },
    state: String,
    postalCode: String,
    country: {
      type: String,
      required: true
    }
  },
  status: {
    type: String,
    enum: ['pending', 'shipped', 'delivered', 'failed'],
    default: 'pending'
  },
  updates: [{
    status: String,
    location: String,
    timestamp: Date,
    description: String
  }]
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  method: {
    type: String,
    required: true,
    enum: ['credit_card', 'debit_card', 'paypal', 'bank_transfer', 'cash']
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    required: true
  },
  transactionId: String,
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'USD'
  },
  paymentDate: Date,
  gateway: String,
  gatewayResponse: Object
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  items: [orderItemSchema],
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
    default: 'pending'
  },
  shipping: shippingSchema,
  payment: paymentSchema,
  subtotal: {
    type: Number,
    required: true
  },
  tax: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  total: {
    type: Number,
    required: true
  },
  notes: [{
    content: String,
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  source: {
    type: String,
    enum: ['web', 'mobile', 'pos', 'marketplace'],
    required: true
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ customer: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'payment.status': 1 });
orderSchema.index({ 'shipping.trackingNumber': 1 });

// Generate unique order number
orderSchema.pre('save', async function(next) {
  if (this.isNew) {
    const lastOrder = await this.constructor.findOne({}, {}, { sort: { 'orderNumber': -1 } });
    const lastNumber = lastOrder ? parseInt(lastOrder.orderNumber.slice(4)) : 0;
    this.orderNumber = `ORD-${(lastNumber + 1).toString().padStart(8, '0')}`;
  }
  next();
});

// Update customer metrics after order save
orderSchema.post('save', async function(doc) {
  try {
    const Customer = mongoose.model('Customer');
    const customer = await Customer.findById(doc.customer);
    if (customer) {
      await customer.updateMetrics(doc);
      
      // Update loyalty points (1 point per dollar spent)
      if (doc.status === 'delivered') {
        await customer.updateLoyaltyPoints(Math.floor(doc.total));
      }
    }
  } catch (error) {
    console.error('Error updating customer metrics:', error);
  }
});

// Calculate totals before saving
orderSchema.pre('save', function(next) {
  // Calculate subtotal
  this.subtotal = this.items.reduce((sum, item) => {
    return sum + (item.price * item.quantity);
  }, 0);

  // Calculate total with tax, shipping, and discounts
  this.total = this.subtotal + this.tax + this.shipping.cost - this.discount;
  
  next();
});

// Instance methods
orderSchema.methods.cancel = async function(reason) {
  this.status = 'cancelled';
  this.notes.push({
    content: `Order cancelled: ${reason}`,
    createdAt: new Date()
  });
  await this.save();
};

orderSchema.methods.refund = async function(amount, reason) {
  if (amount > this.total) {
    throw new Error('Refund amount cannot exceed order total');
  }
  
  this.status = 'refunded';
  this.payment.status = 'refunded';
  this.notes.push({
    content: `Refunded ${amount}: ${reason}`,
    createdAt: new Date()
  });
  
  await this.save();
};

const Order = mongoose.model('Order', orderSchema);

export default Order;