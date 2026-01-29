CREATE DATABASE IF NOT EXISTS cdc_demo;
USE cdc_demo;

-- 1) 원본 테이블: products
CREATE TABLE IF NOT EXISTS products (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  price INT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2) 원본 테이블: stocks (재고)
CREATE TABLE IF NOT EXISTS stocks (
  product_id BIGINT PRIMARY KEY,
  qty INT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_stocks_product
    FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE CASCADE
);


-- 3) Outbox 이벤트 테이블
CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  aggregate_type VARCHAR(50) NOT NULL,     -- ex) "product"
  aggregate_id BIGINT NOT NULL,            -- ex) product.id
  event_type VARCHAR(50) NOT NULL,         -- ex) "PRODUCT_UPSERTED"
  payload_json JSON NOT NULL,              -- 이벤트 내용
  status VARCHAR(20) NOT NULL DEFAULT 'NEW', -- NEW / SENT / FAILED
  published_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dedupe (aggregate_type, aggregate_id, event_type, created_at)
);

ALTER TABLE outbox_events
  ADD COLUMN retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN last_error TEXT NULL;

CREATE INDEX idx_outbox_status_id ON outbox_events(status, id);

-- 4) Projection 테이블 (조회 최적화 / 검색용)
CREATE TABLE IF NOT EXISTS product_search (
  product_id BIGINT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  price INT NOT NULL,
  qty INT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);