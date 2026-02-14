import mongoose from 'mongoose';
const { Schema } = mongoose;

const userSchema = new Schema({
  name: String,
  email: { type: String, required: true },
  age: Number,
});

export const User = mongoose.model('User', userSchema);
