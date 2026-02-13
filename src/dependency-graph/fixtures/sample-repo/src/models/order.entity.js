// WIP: Initial module design - order.entity.js
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Order {
  @PrimaryGeneratedColumn()
  id;

  @Column()
  status;

  @Column()
  total;
}
