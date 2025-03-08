import mongoose from 'mongoose';

const socialProfileSchema = new mongoose.Schema({
  platform: {
    type: String,
    enum: ['facebook', 'instagram', 'twitter', 'linkedin'],
    required: true
  },
  profileId: String,
  username: String,
  profileUrl: String,
  lastSync: Date
}, { _id: false });

const addressSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['billing', 'shipping'],
    required: true
  },
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
  },
  isDefault: {
    type: Boolean,
    default: false
  }
}, { _id: true, timestamps: true });

const customerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  customerNumber: {
    type: String,
    unique: true,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'blocked'],
    default: 'active'
  },
  type: {
    type: String,
    enum: ['individual', 'business'],
    default: 'individual'
  },
  company: {
    name: String,
    registrationNumber: String,
    taxId: String
  },
  contactPreferences: {
    email: {
      type: Boolean,
      default: true
    },
    sms: {
      type: Boolean,
      default: false
    },
    whatsapp: {
      type: Boolean,
      default: false
    },
    phone: {
      type: Boolean,
      default: false
    }
  },
  addresses: [addressSchema],
  socialProfiles: [socialProfileSchema],
  segments: [{
    type: String,
    ref: 'Segment'
  }],
  tags: [{
    type: String
  }],
  loyalty: {
    points: {
      type: Number,
      default: 0
    },
    tier: {
      type: String,
      enum: ['bronze', 'silver', 'gold', 'platinum'],
      default: 'bronze'
    },
    joinDate: Date
  },
  metrics: {
    totalOrders: {
      type: Number,
      default: 0
    },
    totalSpent: {
      type: Number,
      default: 0
    },
    averageOrderValue: {
      type: Number,
      default: 0
    },
    lastPurchaseDate: Date,
    firstPurchaseDate: Date
  },
  preferences: {
    categories: [{
      type: String
    }],
    brands: [{
      type: String
    }],
    sizes: [{
      type: String
    }],
    colors: [{
      type: String
    }]
  },
  gdpr: {
    consentDate: Date,
    dataRetentionDate: Date,
    marketingConsent: {
      type: Boolean,
      default: false
    },
    dataProcessingConsent: {
      type: Boolean,
      default: false
    }
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
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes
customerSchema.index({ customerNumber: 1 });
customerSchema.index({ 'company.name': 1 });
customerSchema.index({ 'metrics.totalSpent': -1 });
customerSchema.index({ 'metrics.lastPurchaseDate': -1 });
customerSchema.index({ tags: 1 });
customerSchema.index({ segments: 1 });

// Generate unique customer number
customerSchema.pre('save', async function(next) {
  if (this.isNew) {
    const lastCustomer = await this.constructor.findOne({}, {}, { sort: { 'customerNumber': -1 } });
    const lastNumber = lastCustomer ? parseInt(lastCustomer.customerNumber.slice(4)) : 0;
    this.customerNumber = `CUS-${(lastNumber + 1).toString().padStart(6, '0')}`;
  }
  next();
});

// Calculate metrics
customerSchema.methods.updateMetrics = async function(order) {
  this.metrics.totalOrders += 1;
  this.metrics.totalSpent += order.total;
  this.metrics.averageOrderValue = this.metrics.totalSpent / this.metrics.totalOrders;
  this.metrics.lastPurchaseDate = order.createdAt;
  
  if (!this.metrics.firstPurchaseDate) {
    this.metrics.firstPurchaseDate = order.createdAt;
  }
  
  await this.save();
};

// Update loyalty points
customerSchema.methods.updateLoyaltyPoints = async function(points, operation = 'add') {
  if (operation === 'add') {
    this.loyalty.points += points;
  } else if (operation === 'subtract') {
    this.loyalty.points = Math.max(0, this.loyalty.points - points);
  }
  
  // Update tier based on points
  if (this.loyalty.points >= 10000) {
    this.loyalty.tier = 'platinum';
  } else if (this.loyalty.points >= 5000) {
    this.loyalty.tier = 'gold';
  } else if (this.loyalty.points >= 1000) {
    this.loyalty.tier = 'silver';
  }
  
  await this.save();
};

const Customer = mongoose.model('Customer', customerSchema);

export default Customer;