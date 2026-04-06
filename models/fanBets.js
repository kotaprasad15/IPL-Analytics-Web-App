const mongoose = require('mongoose');
const { Schema } = mongoose;

// 1. User Schema
const userSchema = new Schema({
  username: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
  },
  password: {
    type: String,
    required: true
  },
  points: {
    type: Number,
    default: 1000,
    min: 0
  },
  stats: {
    totalBets: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 }
  }
}, { timestamps: true });

// 2. Match Schema
const matchSchema = new Schema({
  matchId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  teamA: {
    type: String,
    required: true
  },
  teamB: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['upcoming', 'live', 'finished'],
    default: 'upcoming'
  },
  score: {
    teamA: { type: String, default: '0/0' },
    teamB: { type: String, default: '0/0' },
    overs: { type: String, default: '0.0' }
  },
  startTime: {
    type: Date,
    required: true
  }
}, { timestamps: true });

// 3. Bet Schema
const optionSchema = new Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  odds: { type: Number, required: true, min: 1.0 }
}, { _id: false });

const betSchema = new Schema({
  matchId: {
    // Referencing the matchId string to align with Match Schema
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['match_winner', 'next_wicket', 'over_under', 'player_runs'],
    required: true
  },
  question: {
    type: String,
    required: true
  },
  options: {
    type: [optionSchema],
    validate: [v => v.length >= 2, 'A bet must have at least two options']
  },
  status: {
    type: String,
    enum: ['open', 'locked', 'settled'],
    default: 'open'
  },
  correctOption: {
    type: String,
    default: null
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }
}, { timestamps: true });

// 4. UserBet Schema
const userBetSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  betId: {
    type: Schema.Types.ObjectId,
    ref: 'Bet',
    required: true,
    index: true
  },
  selectedOption: {
    type: String,
    required: true
  },
  pointsWagered: {
    type: Number,
    required: true,
    min: 1
  },
  status: {
    type: String,
    enum: ['pending', 'won', 'lost'],
    default: 'pending'
  },
  pointsWon: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

// Prevent a user from placing the same bet multiple times (optional, adjust based on rules)
userBetSchema.index({ userId: 1, betId: 1 }, { unique: true });

// 5. Leaderboard Schema (Optional View or Snapshot Collection)
const leaderboardSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  username: {
    type: String,
    required: true
  },
  points: {
    type: Number,
    required: true,
    index: -1 // Descending index for fast leaderboard queries
  }
}, { timestamps: true });


// Export Models
const User = mongoose.model('User', userSchema);
const Match = mongoose.model('Match', matchSchema);
const Bet = mongoose.model('Bet', betSchema);
const UserBet = mongoose.model('UserBet', userBetSchema);
const Leaderboard = mongoose.model('Leaderboard', leaderboardSchema);

module.exports = {
  User,
  Match,
  Bet,
  UserBet,
  Leaderboard
};
