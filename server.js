import express from "express";
import mongoose from "mongoose";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// ---------------------
// MONGO CONNECTION
// ---------------------
const MONGO_URI = process.env.MONGO_URI;
await mongoose.connect(MONGO_URI, {});

// ---------------------
// SCHEMAS
// ---------------------
const User = mongoose.model("User", new mongoose.Schema({
  chatId: { type: String, unique: true },
  username: String,
  avatar: String,
  status: { type: String, default: "active" },
  referral_code: String,
  referred_by: String,
  created_at: { type: Date, default: Date.now }
}));

const Wallet = mongoose.model("Wallet", new mongoose.Schema({
  chatId: { type: String, unique: true },
  balance: { type: Number, default: 0 },
  pending_balance: { type: Number, default: 0 },
  currency: { type: String, default: "INR" }
}));

const Txn = mongoose.model("Txn", new mongoose.Schema({
  chatId: String,
  type: String,
  amount: Number,
  description: String,
  status: String,
  timestamp: { type: Date, default: Date.now },
  metadata: {}
}));

const UPI = mongoose.model("UPI", new mongoose.Schema({
  chatId: { type: String, unique: true },
  vpa: String,
  bank_name: String,
  is_verified: Boolean,
  linked_at: Date
}));

const Referral = mongoose.model("Referral", new mongoose.Schema({
  chatId: String,
  referral_code: String,
  referred_users: [{
    user_id: String,
    username: String,
    joined_at: Date,
    earned_amount: Number,
    is_active: Boolean
  }],
  total_earned: { type: Number, default: 0 },
  pending_earned: { type: Number, default: 0 }
}));

const Withdraw = mongoose.model("Withdraw", new mongoose.Schema({
  chatId: String,
  amount: Number,
  vpa: String,
  fee: Number,
  net_amount: Number,
  status: String,
  initiated_at: Date,
  completed_at: Date,
  transaction_id: String,
  failure_reason: String
}));

// ----------------------------------------------
// 1. USER API + REFERRAL
// ----------------------------------------------
app.get("/api/user/info", async (req, res) => {
  const { chatId, username, avatar, ref } = req.query;

  if (!chatId) return res.json({ error: "chatId required" });

  let user = await User.findOne({ chatId });

  if (!user) {
    const referralCode = Math.floor(100000 + Math.random() * 900000).toString();

    user = await User.create({
      chatId,
      username,
      avatar,
      referral_code: referralCode,
      referred_by: ref || null
    });

    // Referral Linking
    if (ref) {
      const inviter = await User.findOne({ referral_code: ref });
      if (inviter) {
        let referral = await Referral.findOne({ chatId: inviter.chatId });

        if (!referral) {
          referral = await Referral.create({
            chatId: inviter.chatId,
            referral_code: inviter.referral_code,
            referred_users: []
          });
        }

        referral.referred_users.push({
          user_id: chatId,
          username,
          joined_at: new Date(),
          earned_amount: 0,
          is_active: false
        });

        await referral.save();
      }
    }

    // Create wallet automatically
    await Wallet.create({ chatId });
  } else {
    user.username = username || user.username;
    user.avatar = avatar || user.avatar;
    await user.save();
  }

  res.json(user);
});

// ----------------------------------------------
// 2. WALLET
// ----------------------------------------------
app.get("/api/wallet/balance", async (req, res) => {
  const { chatId } = req.query;
  let wallet = await Wallet.findOne({ chatId });
  if (!wallet) wallet = await Wallet.create({ chatId });

  res.json({
    balance: wallet.balance.toFixed(2),
    available_balance: wallet.balance.toFixed(2),
    pending_balance: wallet.pending_balance.toFixed(2),
    currency: wallet.currency
  });
});

app.get("/api/wallet/transactions", async (req, res) => {
  const { chatId, limit = 20, offset = 0 } = req.query;

  const tx = await Txn.find({ chatId })
    .sort({ timestamp: -1 })
    .skip(Number(offset))
    .limit(Number(limit));

  const total = await Txn.countDocuments({ chatId });

  res.json({ transactions: tx, total });
});

// ----------------------------------------------
// 3. UPI
// ----------------------------------------------
app.get("/api/upi", async (req, res) => {
  const { chatId, vpa, bank_name } = req.query;

  let upi = await UPI.findOne({ chatId });

  if (!upi) {
    upi = await UPI.create({
      chatId,
      vpa,
      bank_name,
      is_verified: true,
      linked_at: new Date()
    });
  } else {
    if (vpa) upi.vpa = vpa;
    if (bank_name) upi.bank_name = bank_name;
    await upi.save();
  }

  res.json(upi);
});

// ----------------------------------------------
// 4. WITHDRAWAL
// ----------------------------------------------
app.post("/api/withdraw/initiate", async (req, res) => {
  const { chatId, amount, vpa } = req.body;

  const fee = 3.00;
  const net = amount - fee;

  const wd = await Withdraw.create({
    chatId,
    amount,
    vpa,
    fee,
    net_amount: net,
    status: "pending",
    initiated_at: new Date()
  });

  res.json({
    withdrawal_id: wd._id,
    amount,
    fee,
    net_amount: net,
    status: "pending",
    estimated_time: "2-4 hours"
  });
});

app.get("/api/withdraw/history", async (req, res) => {
  const { chatId, limit = 10, offset = 0 } = req.query;

  const data = await Withdraw.find({ chatId })
    .sort({ initiated_at: -1 })
    .skip(Number(offset))
    .limit(Number(limit));

  const total = await Withdraw.countDocuments({ chatId });

  res.json({ withdrawals: data, total });
});

// ----------------------------------------------
// 5. REFERRALS
// ----------------------------------------------
app.get("/api/referral", async (req, res) => {
  const { chatId } = req.query;

  const user = await User.findOne({ chatId });
  const ref = await Referral.findOne({ chatId });

  res.json({
    code: user.referral_code,
    link: `https://t.me/winzoplay_bot?start=${user.referral_code}`,
    total_referrals: ref?.referred_users.length || 0,
    successful_referrals: ref?.referred_users.filter(x => x.is_active).length || 0,
    total_earned: (ref?.total_earned || 0).toFixed(2),
    pending_earned: (ref?.pending_earned || 0).toFixed(2),
    commission_per_referral: "3.00"
  });
});

app.get("/api/referral/users", async (req, res) => {
  const { chatId, limit = 20, offset = 0 } = req.query;

  const ref = await Referral.findOne({ chatId });

  const list = ref?.referred_users.slice(Number(offset), Number(offset) + Number(limit)) || [];

  res.json({
    referrals: list,
    total: ref?.referred_users.length || 0
  });
});

// ----------------------------------------------
export default app;
