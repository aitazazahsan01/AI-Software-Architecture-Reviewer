// WIP: Initial module design - product.model.js
import { DataTypes } from 'sequelize';
import { sequelize } from '../db.js';

export const Product = sequelize.define('Product', {
  name: DataTypes.STRING,
  price: DataTypes.FLOAT,
});
