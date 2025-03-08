import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
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
  addedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const cartSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  items: [cartItemSchema],
  status: {
    type: String,
    enum: ['active', 'abandoned', 'converted', 'expired'],
    default: 'active'
  },
  totalValue: {
    type: Number,
    default: 0
  },
  source: {
    type: String,
    enum: ['web', 'mobile', 'pos'],
    required: true
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  abandonedAt: Date,
  recoveryAttempts: [{
    type: {
      type: String,
      enum: ['email', 'whatsapp', 'sms'],
      required: true
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MessageTemplate'
    },
    sentAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'failed'],
      default: 'sent'
    },
    response: {
      type: String,
      enum: ['none', 'opened', 'clicked', 'converted'],
      default: 'none'
    }
  }],
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  sessionData: {
    deviceId: String,
    userAgent: String,
    ipAddress: String,
    referrer: String
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  }
}, {
  timestamps: true
});

// Indexes
cartSchema.index({ customer: 1, status: 1 });
cartSchema.index({ lastActivity: 1 });
cartSchema.index({ status: 1, abandonedAt: 1 });
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Update total value when items change
cartSchema.pre('save', function(next) {
  this.totalValue = this.items.reduce((total, item) => {
    return total + (item.price * item.quantity);
  }, 0);
  next();
});

// Instance methods
cartSchema.methods.addItem = async function(productId, quantity) {
  const existingItem = this.items.find(
    item => item.product.toString() === productId.toString()
  );

  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    const Product = mongoose.model('Product');
    const product = await Product.findById(productId);
    
    if (!product) {
      throw new Error('Product not found');
    }

    this.items.push({
      product: productId,
      quantity,
      price: product.price
    });
  }

  this.lastActivity = new Date();
  await this.save();
};

cartSchema.methods.removeItem = async function(productId) {
  this.items = this.items.filter(
    item => item.product.toString() !== productId.toString()
  );
  
  this.lastActivity = new Date();
  await this.save();
};

cartSchema.methods.updateQuantity = async function(productId, quantity) {
  const item = this.items.find(
    item => item.product.toString() === productId.toString()
  );

  if (!item) {
    throw new Error('Item not found in cart');
  }

  item.quantity = quantity;
  this.lastActivity = new Date();
  await this.save();
};

cartSchema.methods.abandon = async function() {
  if (this.status === 'active') {
    this.status = 'abandoned';
    this.abandonedAt = new Date();
    await this.save();
  }
};

cartSchema.methods.recover = async function() {
  if (this.status === 'abandoned') {
    this.status = 'active';
    this.abandonedAt = null;
    this.lastActivity = new Date();
    await this.save();
  }
};

cartSchema.methods.convert = async function() {
  this.status = 'converted';
  await this.save();
};

cartSchema.methods.expire = async function() {
  this.status = 'expired';
  await this.save();
};

cartSchema.methods.logRecoveryAttempt = async function(type, templateId) {
  this.recoveryAttempts.push({
    type,
    templateId,
    sentAt: new Date()
  });
  await this.save();
};

cartSchema.methods.updateRecoveryResponse = async function(attemptId, response) {
  const attempt = this.recoveryAttempts.id(attemptId);
  if (attempt) {
    attempt.response = response;
    if (response === 'converted') {
      this.status = 'converted';
    }
    await this.save();
  }
};

// Static methods
cartSchema.statics.findAbandoned = function(criteria = {}) {
  return this.find({
    ...criteria,
    status: 'abandoned',
    totalValue: { $gt: 0 }
  }).sort({ abandonedAt: -1 });
};

cartSchema.statics.findActive = function(customerId) {
  return this.findOne({
    customer: customerId,
    status: 'active'
  }).populate('items.product');
};

cartSchema.statics.getAbandonmentStats = async function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalValue: { $sum: '$totalValue' }
      }
    }
  ]);
};

const Cart = mongoose.model('Cart', cartSchema);

export default Cart;