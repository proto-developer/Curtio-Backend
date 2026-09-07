const mongoose = require("mongoose");

const ownerSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
}, { timestamps: true });

const Owner = mongoose.model("Owner", ownerSchema, "owners");

module.exports = Owner;
