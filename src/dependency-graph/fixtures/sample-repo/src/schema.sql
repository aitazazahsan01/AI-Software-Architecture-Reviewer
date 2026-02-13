CREATE TABLE IF NOT EXISTS invoices (
  id INT PRIMARY KEY,
  customer_id INT NOT NULL,
  amount DECIMAL(10,2),
  PRIMARY KEY (id)
);
