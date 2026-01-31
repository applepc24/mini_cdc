--
-- PostgreSQL database dump
--

\restrict 56JMA9veyCDOzBV5AttXJGnYRLlxMZiGdSRNbUt9povmiiXaYQNA62CLdR4DIOg

-- Dumped from database version 16.11 (Debian 16.11-1.pgdg12+1)
-- Dumped by pg_dump version 16.11 (Debian 16.11-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: inventory_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_events (
    id bigint NOT NULL,
    owner_id bigint NOT NULL,
    product_id bigint NOT NULL,
    event_type character varying(20) NOT NULL,
    delta_qty integer DEFAULT 0 NOT NULL,
    snapshot_qty integer,
    note text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT inventory_events_event_type_check CHECK (((event_type)::text = ANY ((ARRAY['snapshot'::character varying, 'receipt'::character varying, 'adjust'::character varying])::text[]))),
    CONSTRAINT inventory_events_snapshot_rule CHECK (((((event_type)::text = 'snapshot'::text) AND (snapshot_qty IS NOT NULL)) OR (((event_type)::text <> 'snapshot'::text) AND (snapshot_qty IS NULL))))
);


--
-- Name: inventory_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_events_id_seq OWNED BY public.inventory_events.id;


--
-- Name: outbox_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbox_events (
    id bigint NOT NULL,
    owner_id bigint NOT NULL,
    aggregate_type character varying(50) NOT NULL,
    aggregate_id bigint NOT NULL,
    event_type character varying(50) NOT NULL,
    payload_json json NOT NULL,
    status character varying(20) DEFAULT 'NEW'::character varying NOT NULL,
    published_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    retry_count integer NOT NULL,
    last_error text
);


--
-- Name: outbox_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outbox_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outbox_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outbox_events_id_seq OWNED BY public.outbox_events.id;


--
-- Name: product_search; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_search (
    product_id bigint NOT NULL,
    owner_id bigint NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(100) NOT NULL,
    price integer NOT NULL,
    qty integer NOT NULL,
    embedding public.vector(1536),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: product_search_product_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_search_product_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_search_product_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.product_search_product_id_seq OWNED BY public.product_search.product_id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id bigint NOT NULL,
    owner_id bigint NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(100) NOT NULL,
    price integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: products_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: products_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.products_id_seq OWNED BY public.products.id;


--
-- Name: restock_idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restock_idempotency (
    id bigint NOT NULL,
    owner_id integer NOT NULL,
    idem_key text NOT NULL,
    endpoint text NOT NULL,
    request_json jsonb NOT NULL,
    response_json jsonb,
    status text DEFAULT 'STARTED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: restock_idempotency_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.restock_idempotency_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: restock_idempotency_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.restock_idempotency_id_seq OWNED BY public.restock_idempotency.id;


--
-- Name: stocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stocks (
    product_id bigint NOT NULL,
    owner_id bigint NOT NULL,
    qty integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    name character varying(100),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: inventory_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_events ALTER COLUMN id SET DEFAULT nextval('public.inventory_events_id_seq'::regclass);


--
-- Name: outbox_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events ALTER COLUMN id SET DEFAULT nextval('public.outbox_events_id_seq'::regclass);


--
-- Name: product_search product_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_search ALTER COLUMN product_id SET DEFAULT nextval('public.product_search_product_id_seq'::regclass);


--
-- Name: products id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products ALTER COLUMN id SET DEFAULT nextval('public.products_id_seq'::regclass);


--
-- Name: restock_idempotency id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restock_idempotency ALTER COLUMN id SET DEFAULT nextval('public.restock_idempotency_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: inventory_events inventory_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_events
    ADD CONSTRAINT inventory_events_pkey PRIMARY KEY (id);


--
-- Name: outbox_events outbox_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);


--
-- Name: product_search product_search_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_search
    ADD CONSTRAINT product_search_pkey PRIMARY KEY (product_id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: restock_idempotency restock_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restock_idempotency
    ADD CONSTRAINT restock_idempotency_pkey PRIMARY KEY (id);


--
-- Name: stocks stocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT stocks_pkey PRIMARY KEY (product_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_inventory_events_owner_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_events_owner_created ON public.inventory_events USING btree (owner_id, created_at DESC);


--
-- Name: idx_inventory_events_product_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_events_product_created ON public.inventory_events USING btree (product_id, created_at DESC);


--
-- Name: idx_product_search_owner_not_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_search_owner_not_deleted ON public.product_search USING btree (owner_id, updated_at DESC) WHERE (is_deleted = false);


--
-- Name: ix_outbox_events_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_outbox_events_owner_id ON public.outbox_events USING btree (owner_id);


--
-- Name: ix_product_search_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_product_search_owner_id ON public.product_search USING btree (owner_id);


--
-- Name: ix_products_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_products_owner_id ON public.products USING btree (owner_id);


--
-- Name: ix_stocks_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_stocks_owner_id ON public.stocks USING btree (owner_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: ux_restock_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_restock_idem ON public.restock_idempotency USING btree (owner_id, idem_key, endpoint);


--
-- Name: inventory_events inventory_events_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_events
    ADD CONSTRAINT inventory_events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: inventory_events inventory_events_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_events
    ADD CONSTRAINT inventory_events_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: outbox_events outbox_events_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbox_events
    ADD CONSTRAINT outbox_events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: product_search product_search_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_search
    ADD CONSTRAINT product_search_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: products products_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: stocks stocks_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT stocks_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: stocks stocks_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stocks
    ADD CONSTRAINT stocks_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 56JMA9veyCDOzBV5AttXJGnYRLlxMZiGdSRNbUt9povmiiXaYQNA62CLdR4DIOg

