--
-- PostgreSQL database dump
--

\restrict bPdbRmfN6fXkzKtlmKfGdNwC86Ru0avcmnsSavrEv8YQ1aOeZ7YtcYNeOb6fL9H

-- Dumped from database version 18.0
-- Dumped by pg_dump version 18.0

-- Started on 2026-11-15 22:15:14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 263 (class 1255 OID 17101)
-- Name: auto_advance_order_statuses(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.auto_advance_order_statuses() RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    order_record RECORD;
    workflow_record RECORD;
BEGIN
    -- Ќ е®¤Ё¬ § Є §л, г Є®в®але ­г¦­® ®Ў­®ўЁвм бв вгб
    FOR order_record IN 
        SELECT o.order_id, o.status, o.next_status_update
        FROM orders o
        WHERE o.next_status_update IS NOT NULL 
        AND o.next_status_update <= NOW()
        AND o.status_auto_escalate = TRUE
        AND o.status NOT IN ('¤®бв ў«Ґ­', '§ ўҐаиҐ­', '®в¬Ґ­Ґ­')
    LOOP
        -- Ќ е®¤Ё¬ б«Ґ¤гойЁ© бв вгб ў workflow
        SELECT * INTO workflow_record 
        FROM order_status_workflow 
        WHERE current_status = order_record.status 
        AND required_action = 'auto';
        
        IF FOUND THEN
            -- ЋЎ­®ў«пҐ¬ бв вгб § Є §  (нв® ўл§®ўҐв ваЁЈЈҐа handle_order_status_change)
            UPDATE orders 
            SET status = workflow_record.next_status,
                updated_at = NOW()
            WHERE order_id = order_record.order_id;
        END IF;
    END LOOP;
END;
$$;


ALTER FUNCTION public.auto_advance_order_statuses() OWNER TO postgres;

--
-- TOC entry 270 (class 1255 OID 17173)
-- Name: auto_create_tasks_from_business_rules(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.auto_create_tasks_from_business_rules() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    entity_type TEXT;
    entity_id UUID;
    rule_record RECORD;
    task_type_text TEXT;
    task_title TEXT;
    task_description TEXT;
    due_date_val TIMESTAMP;
BEGIN
    -- ЋЇаҐ¤Ґ«пҐ¬ вЁЇ бгй­®бвЁ Ё ID
    CASE TG_TABLE_NAME
        WHEN 'returns' THEN
            entity_type := 'return';
            entity_id := NEW.return_id;
            task_type_text := 'return_processing';
        WHEN 'quality_claims' THEN
            entity_type := 'quality_claim';
            entity_id := NEW.claim_id;
            task_type_text := 'quality_control';
        WHEN 'shipments' THEN
            entity_type := 'shipment';
            entity_id := NEW.shipment_id;
            task_type_text := 'delivery_monitoring';
        WHEN 'orders' THEN
            entity_type := 'order';
            entity_id := NEW.order_id;
            task_type_text := 'order_processing';
        ELSE
            RETURN NEW;
    END CASE;

    -- €йҐ¬ Ї®¤е®¤пйҐҐ ЎЁ§­Ґб-Їа ўЁ«® (ЎҐ§ ORDER BY priority)
    SELECT * INTO rule_record
    FROM business_rules
    WHERE rule_type = task_type_text
      AND is_active = TRUE
      AND (effective_to IS NULL OR effective_to > NOW())
    LIMIT 1;

    -- …б«Ё Їа ўЁ«® ­ ©¤Ґ­® - б®§¤ Ґ¬ § ¤ зг
    IF FOUND THEN
        -- ЋЇаҐ¤Ґ«пҐ¬ ба®Є ўлЇ®«­Ґ­Ёп
        IF rule_record.value ? 'due_hours' THEN
            due_date_val := NOW() + (rule_record.value->>'due_hours')::INTEGER * INTERVAL '1 hour';
        ELSIF rule_record.value ? 'due_days' THEN
            due_date_val := NOW() + (rule_record.value->>'due_days')::INTEGER * INTERVAL '1 day';
        ELSE
            due_date_val := NOW() + INTERVAL '24 hours';
        END IF;

        -- ”®а¬ЁагҐ¬ § Ј®«®ў®Є Ё ®ЇЁб ­ЁҐ
        task_title := rule_record.name || ' - ' || entity_id;
        task_description := rule_record.description || ' (Ђўв®¬ вЁзҐбЄЁ б®§¤ ­® ¤«п ' || entity_type || ')';

        -- ‘®§¤ Ґ¬ § ¤ зг
        INSERT INTO tasks (
            business_rule_id,
            order_id,
            shipment_id,
            return_id,
            quality_claim_id,
            task_type,
            title,
            description,
            status,
            priority,
            due_date,
            auto_created,
            created_at
        ) VALUES (
            rule_record.rule_id,
            CASE WHEN entity_type = 'order' THEN entity_id ELSE NULL END,
            CASE WHEN entity_type = 'shipment' THEN entity_id ELSE NULL END,
            CASE WHEN entity_type = 'return' THEN entity_id ELSE NULL END,
            CASE WHEN entity_type = 'quality_claim' THEN entity_id ELSE NULL END,
            task_type_text,
            task_title,
            task_description,
            'new',
            COALESCE((rule_record.value->>'priority')::INTEGER, 3),
            due_date_val,
            TRUE,
            NOW()
        );
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION public.auto_create_tasks_from_business_rules() OWNER TO postgres;

--
-- TOC entry 266 (class 1255 OID 41573)
-- Name: calculate_cart_total(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.calculate_cart_total(p_cart_id uuid) RETURNS TABLE(total_items integer, total_unique_items integer, subtotal numeric, estimated_tax numeric, shipping_cost numeric, final_amount numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH cart_summary AS (
        SELECT 
            COUNT(*) as unique_items,
            SUM(quantity) as total_quantity,
            SUM(item_total) as subtotal
        FROM cart_details_view
        WHERE cart_id = p_cart_id
    )
    SELECT 
        cs.total_quantity::INTEGER as total_items,
        cs.unique_items::INTEGER as total_unique_items,
        COALESCE(cs.subtotal, 0) as subtotal,
        COALESCE(cs.subtotal * 0.2, 0) as estimated_tax, -- 20% ­ «®Ј
        0 as shipping_cost, -- Њ®¦­® ¤®Ў ўЁвм «®ЈЁЄг а бзҐв  ¤®бв ўЄЁ
        COALESCE(cs.subtotal * 1.2, 0) as final_amount -- subtotal + tax
    FROM cart_summary cs;
END;
$$;


ALTER FUNCTION public.calculate_cart_total(p_cart_id uuid) OWNER TO postgres;

--
-- TOC entry 267 (class 1255 OID 41574)
-- Name: cleanup_old_carts(integer); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.cleanup_old_carts(IN p_days_old integer DEFAULT 30)
    LANGUAGE plpgsql
    AS $$
BEGIN
    DELETE FROM cart 
    WHERE created_at < NOW() - (p_days_old || ' days')::INTERVAL
    AND user_id IS NULL; -- “¤ «пҐ¬ в®«мЄ® бҐббЁ®­­лҐ Є®а§Ё­л
    
    RAISE NOTICE '“¤ «Ґ­л бв алҐ Є®а§Ё­л (бв аиҐ % ¤­Ґ©)', p_days_old;
END;
$$;


ALTER PROCEDURE public.cleanup_old_carts(IN p_days_old integer) OWNER TO postgres;

--
-- TOC entry 264 (class 1255 OID 17102)
-- Name: confirm_delivery(uuid, uuid, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.confirm_delivery(p_shipment_id uuid, p_employee_id uuid, p_recipient_signature character varying DEFAULT NULL::character varying) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    order_id_val UUID;
    confirmation_code_val VARCHAR;
BEGIN
    -- Џ®«гз Ґ¬ order_id Ё§ ¤®бв ўЄЁ
    SELECT s.order_id INTO order_id_val
    FROM shipments s
    WHERE s.shipment_id = p_shipment_id
    AND s.assigned_employee_id = p_employee_id;
    
    IF order_id_val IS NULL THEN
        RETURN FALSE; -- „®бв ўЄ  ­Ґ ­ ©¤Ґ­  Ё«Ё б®ваг¤­ЁЄ ­Ґ ­ §­ зҐ­
    END IF;
    
    -- ѓҐ­ҐаЁагҐ¬ Є®¤ Ї®¤вўҐа¦¤Ґ­Ёп
    confirmation_code_val := upper(substring(md5(random()::text) from 1 for 6));
    
    -- ЋЎ­®ў«пҐ¬ бв вгб § Є §  ­  "¤®бв ў«Ґ­"
    UPDATE orders 
    SET status = '¤®бв ў«Ґ­',
        delivery_confirmation_code = confirmation_code_val,
        updated_at = NOW()
    WHERE order_id = order_id_val;
    
    -- ЋЎ­®ў«пҐ¬ ¤®бв ўЄг
    UPDATE shipments 
    SET status = '¤®бв ў«Ґ­®',
        actual_delivery = NOW(),
        recipient_signature = p_recipient_signature,
        updated_at = NOW()
    WHERE shipment_id = p_shipment_id;
    
    RETURN TRUE;
END;
$$;


ALTER FUNCTION public.confirm_delivery(p_shipment_id uuid, p_employee_id uuid, p_recipient_signature character varying) OWNER TO postgres;

--
-- TOC entry 268 (class 1255 OID 41654)
-- Name: create_shipment_task(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_shipment_task() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_address_text TEXT;
BEGIN
    -- Џ®«гз Ґ¬ Ї®«­л©  ¤аҐб Ё§ в Ў«Ёжл user_addresses
    SELECT 
        COALESCE(ua.country || ', ', '') ||
        COALESCE(ua.region || ', ', '') ||
        COALESCE(ua.city || ', ', '') ||
        COALESCE(ua.postal_code || ', ', '') ||
        COALESCE(ua.street || ' ', '') ||
        COALESCE('¤. ' || ua.house, '') ||
        COALESCE(' Є. ' || ua.building, '') ||
        COALESCE(' Єў. ' || ua.apartment, '')
    INTO v_address_text
    FROM user_addresses ua
    WHERE ua.address_id = NEW.delivery_address_id;
    
    IF NEW.task_id IS NULL THEN
        INSERT INTO tasks (order_id, task_type, title, description, status, priority, due_date)
        VALUES (
            NEW.order_id,
            'delivery',
            '„®бв ўЄ  § Є §  ' || (SELECT order_number FROM orders WHERE order_id = NEW.order_id),
            '„®бв ўЄ  в®ў а  Ї®  ¤аҐбг: ' || v_address_text,
            'pending',
            2,
            NEW.estimated_delivery
        )
        RETURNING task_id INTO NEW.task_id;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.create_shipment_task() OWNER TO postgres;

--
-- TOC entry 261 (class 1255 OID 17094)
-- Name: create_tasks_from_business_rules(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_tasks_from_business_rules() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- …б«Ё б®§¤ Ґвбп ¤®бв ўЄ , Їа®ўҐапҐ¬ ЎЁ§­Ґб-Їа ўЁ«  ¤«п б®§¤ ­Ёп § ¤ з
    IF TG_TABLE_NAME = 'shipments' THEN
        INSERT INTO tasks (
            shipment_id,
            assigned_to,
            business_rule_id,
            task_type,
            title,
            description,
            status,
            priority,
            due_date
        )
        SELECT 
            NEW.shipment_id,
            NULL, -- Ўг¤Ґв ­ §­ зҐ­® Ї®§¦Ґ
            br.rule_id,
            'delivery_check',
            'Џа®ўҐаЄ  ¤®бв ўЄЁ: ' || NEW.tracking_number,
            br.description,
            'new',
            (br.value->>'priority')::INTEGER,
            NEW.estimated_delivery + INTERVAL '1 day'
        FROM business_rules br
        WHERE br.rule_type = 'delivery'
        AND br.is_active = TRUE
        AND NOW() BETWEEN br.effective_from AND COALESCE(br.effective_to, 'infinity'::TIMESTAMP);
    
    -- …б«Ё б®§¤ Ґвбп ў®§ўа в, Їа®ўҐапҐ¬ ЎЁ§­Ґб-Їа ўЁ« 
    ELSIF TG_TABLE_NAME = 'returns' THEN
        INSERT INTO tasks (
            order_id,
            business_rule_id,
            task_type,
            title,
            description,
            status,
            priority
        )
        SELECT 
            NEW.order_id,
            br.rule_id,
            'return_processing',
            'ЋЎа Ў®вЄ  ў®§ўа в : ' || NEW.return_id,
            br.description,
            'new',
            (br.value->>'priority')::INTEGER
        FROM business_rules br
        WHERE br.rule_type = 'return'
        AND br.is_active = TRUE
        AND NOW() BETWEEN br.effective_from AND COALESCE(br.effective_to, 'infinity'::TIMESTAMP);
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.create_tasks_from_business_rules() OWNER TO postgres;

--
-- TOC entry 269 (class 1255 OID 41666)
-- Name: get_formatted_address(uuid); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_formatted_address(address_id uuid) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_address_text TEXT;
BEGIN
    SELECT 
        CONCAT(
            COALESCE(ua.recipient_name || ', ', ''),
            COALESCE('вҐ«: ' || ua.recipient_phone || ', ', ''),
            COALESCE(ua.country || ', ', ''),
            COALESCE(ua.region || ', ', ''),
            COALESCE('Ј. ' || ua.city || ', ', ''),
            COALESCE('Ё­¤ҐЄб: ' || ua.postal_code || ', ', ''),
            COALESCE('г«. ' || ua.street || ', ', ''),
            COALESCE('¤. ' || ua.house, ''),
            COALESCE(' Є®аЇ. ' || ua.building, ''),
            COALESCE(' Єў. ' || ua.apartment, '')
        )
    INTO v_address_text
    FROM user_addresses ua
    WHERE ua.address_id = get_formatted_address.address_id;
    
    RETURN v_address_text;
END;
$$;


ALTER FUNCTION public.get_formatted_address(address_id uuid) OWNER TO postgres;

--
-- TOC entry 265 (class 1255 OID 41572)
-- Name: get_or_create_cart(uuid, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_or_create_cart(p_user_id uuid DEFAULT NULL::uuid, p_session_id character varying DEFAULT NULL::character varying) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_cart_id UUID;
BEGIN
    -- Џлв Ґ¬бп ­ ©вЁ бгйҐбвўгойго Є®а§Ё­г
    IF p_user_id IS NOT NULL THEN
        SELECT cart_id INTO v_cart_id
        FROM cart 
        WHERE user_id = p_user_id 
        ORDER BY created_at DESC 
        LIMIT 1;
    ELSIF p_session_id IS NOT NULL THEN
        SELECT cart_id INTO v_cart_id
        FROM cart 
        WHERE session_id = p_session_id 
        ORDER BY created_at DESC 
        LIMIT 1;
    END IF;
    
    -- …б«Ё ­Ґ ­ и«Ё - б®§¤ Ґ¬ ­®ўго
    IF v_cart_id IS NULL THEN
        INSERT INTO cart (user_id, session_id)
        VALUES (p_user_id, p_session_id)
        RETURNING cart_id INTO v_cart_id;
    END IF;
    
    RETURN v_cart_id;
END;
$$;


ALTER FUNCTION public.get_or_create_cart(p_user_id uuid, p_session_id character varying) OWNER TO postgres;

--
-- TOC entry 262 (class 1255 OID 17099)
-- Name: handle_order_status_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_order_status_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    workflow_record RECORD;
    shipment_record RECORD;
    next_update_time TIMESTAMP;
    confirmation_code TEXT;
BEGIN
    -- …б«Ё бв вгб Ё§¬Ґ­Ё«бп
    IF NEW.status != OLD.status THEN
        -- ‘®§¤ Ґ¬ гўҐ¤®¬«Ґ­ЁҐ ¤«п Ї®«м§®ў вҐ«п
        INSERT INTO notifications (
            user_id,
            order_id,
            type,
            title,
            message,
            sent_via,
            template_type,
            is_delivered
        )
        SELECT 
            o.user_id,
            NEW.order_id,
            'status_update',
            '‘в вгб § Є §  Ё§¬Ґ­Ґ­',
            '‘в вгб ў иҐЈ® § Є §  ' || o.order_number || ' Ё§¬Ґ­Ґ­ ­ : ' || NEW.status,
            'email',
            wf.notification_template,
            FALSE
        FROM orders o
        LEFT JOIN order_status_workflow wf ON wf.current_status = OLD.status AND wf.next_status = NEW.status
        WHERE o.order_id = NEW.order_id;
        
        -- …б«Ё бв вгб "¤®бв ў«Ґ­", ЈҐ­ҐаЁагҐ¬ Є®¤ Ї®¤вўҐа¦¤Ґ­Ёп
        IF NEW.status = '¤®бв ў«Ґ­' THEN
            confirmation_code := upper(substring(md5(random()::text) from 1 for 6));
            NEW.delivery_confirmation_code := confirmation_code;
            
            -- ‘®§¤ Ґ¬ гўҐ¤®¬«Ґ­ЁҐ б Є®¤®¬ Ї®¤вўҐа¦¤Ґ­Ёп
            INSERT INTO notifications (
                user_id,
                order_id,
                type,
                title,
                message,
                sent_via,
                is_delivered
            )
            SELECT 
                user_id,
                NEW.order_id,
                'delivery_confirmation',
                '‡ Є § ¤®бв ў«Ґ­',
                '‚ и § Є § ' || order_number || ' ¤®бв ў«Ґ­. Љ®¤ Ї®¤вўҐа¦¤Ґ­Ёп: ' || confirmation_code,
                'sms',
                FALSE
            FROM orders WHERE order_id = NEW.order_id;
        END IF;
        
        -- “бв ­ ў«Ёў Ґ¬ б«Ґ¤гойҐҐ  ўв®¬ вЁзҐбЄ®Ґ ®Ў­®ў«Ґ­ЁҐ бв вгб 
        SELECT * INTO workflow_record 
        FROM order_status_workflow 
        WHERE current_status = NEW.status 
        AND auto_transition_minutes IS NOT NULL;
        
        IF FOUND THEN
            NEW.next_status_update := NOW() + (workflow_record.auto_transition_minutes || ' minutes')::INTERVAL;
        ELSE
            NEW.next_status_update := NULL;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.handle_order_status_change() OWNER TO postgres;

--
-- TOC entry 249 (class 1255 OID 17103)
-- Name: process_automatic_order_updates(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.process_automatic_order_updates() RETURNS TABLE(processed_orders integer, sent_notifications integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    orders_processed INT := 0;
    notifications_sent INT := 0;
BEGIN
    -- Ђўв®¬ вЁзҐбЄЁ ®Ў­®ў«пҐ¬ бв вгбл § Є §®ў
    SELECT COUNT(*) INTO orders_processed 
    FROM auto_advance_order_statuses();
    
    -- ‡¤Ґбм ¬®¦­® ¤®Ў ўЁвм ¤агЈго  ўв®¬ вЁзҐбЄго ®Ўа Ў®вЄг
    
    RETURN QUERY SELECT orders_processed, notifications_sent;
END;
$$;


ALTER FUNCTION public.process_automatic_order_updates() OWNER TO postgres;

--
-- TOC entry 248 (class 1255 OID 16962)
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 239 (class 1259 OID 33388)
-- Name: auth_group; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auth_group (
    id integer NOT NULL,
    name character varying(150) NOT NULL
);


ALTER TABLE public.auth_group OWNER TO postgres;

--
-- TOC entry 238 (class 1259 OID 33387)
-- Name: auth_group_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.auth_group ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.auth_group_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 241 (class 1259 OID 33398)
-- Name: auth_group_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auth_group_permissions (
    id bigint NOT NULL,
    group_id integer NOT NULL,
    permission_id integer NOT NULL
);


ALTER TABLE public.auth_group_permissions OWNER TO postgres;

--
-- TOC entry 240 (class 1259 OID 33397)
-- Name: auth_group_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.auth_group_permissions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.auth_group_permissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 237 (class 1259 OID 33378)
-- Name: auth_permission; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auth_permission (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    content_type_id integer NOT NULL,
    codename character varying(100) NOT NULL
);


ALTER TABLE public.auth_permission OWNER TO postgres;

--
-- TOC entry 236 (class 1259 OID 33377)
-- Name: auth_permission_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.auth_permission ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.auth_permission_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 220 (class 1259 OID 16566)
-- Name: brands; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.brands (
    brand_id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    logo_url character varying(500),
    website character varying(200),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.brands OWNER TO postgres;

--
-- TOC entry 233 (class 1259 OID 17034)
-- Name: business_rules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.business_rules (
    rule_id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    rule_type character varying(30),
    value jsonb NOT NULL,
    description text,
    applies_to_entity character varying(50),
    applies_to_entity_id uuid,
    effective_from timestamp without time zone DEFAULT now(),
    effective_to timestamp without time zone,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT business_rules_check CHECK (((effective_to IS NULL) OR (effective_to > effective_from)))
);


ALTER TABLE public.business_rules OWNER TO postgres;

--
-- TOC entry 242 (class 1259 OID 41545)
-- Name: cart; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cart (
    cart_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_id character varying(100),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.cart OWNER TO postgres;

--
-- TOC entry 243 (class 1259 OID 41575)
-- Name: cart_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cart_items (
    cart_item_id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_id uuid NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid,
    quantity integer NOT NULL,
    added_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT cart_items_quantity_check CHECK ((quantity > 0))
);


ALTER TABLE public.cart_items OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16546)
-- Name: categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.categories (
    category_id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    parent_id uuid,
    description text,
    image_url character varying(500),
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.categories OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 16590)
-- Name: colors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.colors (
    color_id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(50) NOT NULL,
    hex_code character varying(7),
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.colors OWNER TO postgres;

--
-- TOC entry 230 (class 1259 OID 16857)
-- Name: employees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employees (
    employee_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    department character varying(50),
    "position" character varying(50),
    hire_date date,
    work_schedule jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.employees OWNER TO postgres;

--
-- TOC entry 228 (class 1259 OID 16770)
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    notification_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    order_id uuid,
    type character varying(50),
    title character varying(200),
    message text,
    sent_via character varying(20),
    is_delivered boolean DEFAULT false,
    sent_at timestamp without time zone DEFAULT now(),
    template_type character varying(50)
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- TOC entry 227 (class 1259 OID 16723)
-- Name: order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_items (
    order_item_id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid,
    quantity integer NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    discount_percentage numeric(5,2) DEFAULT 0,
    total_price numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.order_items OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 16696)
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    order_id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_number character varying(20) NOT NULL,
    user_id uuid NOT NULL,
    status character varying(30),
    order_date timestamp without time zone DEFAULT now() NOT NULL,
    total_amount numeric(10,2) NOT NULL,
    discount_amount numeric(10,2) DEFAULT 0,
    shipping_amount numeric(10,2) DEFAULT 0,
    final_amount numeric(10,2) NOT NULL,
    payment_status character varying(20),
    payment_method character varying(20),
    customer_notes text,
    internal_notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    delivery_confirmation_code character varying(10),
    next_status_update timestamp without time zone,
    status_auto_escalate boolean DEFAULT true,
    shipping_address_id uuid,
    billing_address_id uuid
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- TOC entry 244 (class 1259 OID 41609)
-- Name: user_addresses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_addresses (
    address_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    address_type character varying(20) DEFAULT 'shipping'::character varying,
    is_default boolean DEFAULT false,
    recipient_name character varying(150),
    recipient_phone character varying(20),
    country character varying(100),
    region character varying(100),
    city character varying(100),
    postal_code character varying(20),
    street character varying(200),
    house character varying(20),
    building character varying(20),
    apartment character varying(20),
    entrance character varying(10),
    floor character varying(10),
    intercom character varying(20),
    landmark text,
    delivery_instructions text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    is_default_shipping boolean DEFAULT false,
    is_default_billing boolean DEFAULT false
);


ALTER TABLE public.user_addresses OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 16601)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    user_id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(100) NOT NULL,
    phone character varying(20),
    password_hash character varying(255) NOT NULL,
    last_name character varying(50) NOT NULL,
    first_name character varying(50) NOT NULL,
    middle_name character varying(50),
    user_role character varying(20),
    registration_date timestamp without time zone DEFAULT now(),
    last_login timestamp without time zone,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 245 (class 1259 OID 41644)
-- Name: order_details_view; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.order_details_view AS
 SELECT o.order_id,
    o.order_number,
    o.order_date,
    o.status AS order_status,
    o.final_amount,
    o.payment_status,
    (((u.first_name)::text || ' '::text) || (u.last_name)::text) AS customer_name,
    u.email AS customer_email,
    sa.recipient_name AS shipping_recipient,
    sa.city AS shipping_city,
    sa.street AS shipping_street,
    ba.recipient_name AS billing_recipient,
    ba.city AS billing_city,
    count(oi.order_item_id) AS items_count,
    sum(oi.quantity) AS total_quantity
   FROM ((((public.orders o
     JOIN public.users u ON ((o.user_id = u.user_id)))
     LEFT JOIN public.user_addresses sa ON ((o.shipping_address_id = sa.address_id)))
     LEFT JOIN public.user_addresses ba ON ((o.billing_address_id = ba.address_id)))
     LEFT JOIN public.order_items oi ON ((o.order_id = oi.order_id)))
  GROUP BY o.order_id, o.order_number, o.order_date, o.status, o.final_amount, o.payment_status, u.first_name, u.last_name, u.email, sa.recipient_name, sa.city, sa.street, ba.recipient_name, ba.city;


ALTER VIEW public.order_details_view OWNER TO postgres;

--
-- TOC entry 247 (class 1259 OID 49767)
-- Name: order_status_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_status_history (
    history_id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    old_status character varying(30),
    new_status character varying(30),
    changed_by uuid,
    change_reason text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.order_status_history OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 16651)
-- Name: product_variants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.product_variants (
    variant_id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    size_id uuid NOT NULL,
    color_id uuid NOT NULL,
    sku character varying(100) NOT NULL,
    price_adjustment numeric(10,2) DEFAULT 0,
    stock_quantity integer DEFAULT 0 NOT NULL,
    reserved_quantity integer DEFAULT 0 NOT NULL,
    min_stock_level integer DEFAULT 5,
    barcode character varying(100),
    variant_images jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true,
    is_default boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT product_variants_check CHECK (((reserved_quantity >= 0) AND (reserved_quantity <= stock_quantity))),
    CONSTRAINT product_variants_stock_quantity_check CHECK ((stock_quantity >= 0))
);


ALTER TABLE public.product_variants OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 16619)
-- Name: products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.products (
    product_id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku character varying(50) NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    short_description character varying(500),
    category_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    base_price numeric(10,2) NOT NULL,
    old_price numeric(10,2),
    gender character varying(20),
    material character varying(200),
    care_instructions text,
    season character varying(50),
    weight_grams integer,
    dimensions character varying(100),
    main_image_url character varying(500),
    is_active boolean DEFAULT true,
    is_featured boolean DEFAULT false,
    tags jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.products OWNER TO postgres;

--
-- TOC entry 229 (class 1259 OID 16819)
-- Name: quality_claims; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.quality_claims (
    claim_id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid,
    claim_type character varying(30),
    description text,
    status character varying(20),
    resolution character varying(50),
    resolution_notes text,
    assigned_to uuid,
    created_at timestamp without time zone DEFAULT now(),
    resolved_at timestamp without time zone
);


ALTER TABLE public.quality_claims OWNER TO postgres;

--
-- TOC entry 234 (class 1259 OID 17054)
-- Name: returns; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.returns (
    return_id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    user_id uuid NOT NULL,
    variant_id uuid,
    business_rule_id uuid,
    return_type character varying(20),
    reason character varying(100),
    status character varying(20),
    return_date timestamp without time zone DEFAULT now(),
    refund_amount numeric(10,2),
    refund_date timestamp without time zone,
    manager_notes text,
    customer_notes text,
    created_at timestamp without time zone DEFAULT now(),
    return_address_id uuid,
    pickup_address_id uuid,
    CONSTRAINT returns_check CHECK (((refund_date IS NULL) OR (refund_date >= return_date))),
    CONSTRAINT returns_refund_amount_check CHECK ((refund_amount >= (0)::numeric))
);


ALTER TABLE public.returns OWNER TO postgres;

--
-- TOC entry 232 (class 1259 OID 16968)
-- Name: shipments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shipments (
    shipment_id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    assigned_employee_id uuid,
    tracking_number character varying(100),
    carrier character varying(100),
    status character varying(20),
    shipment_date timestamp without time zone,
    estimated_delivery date,
    actual_delivery timestamp without time zone,
    shipping_cost numeric(10,2) NOT NULL,
    recipient_signature character varying(255),
    courier_notes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    business_rule_id uuid,
    delivery_address_id uuid,
    CONSTRAINT shipments_check CHECK (((actual_delivery IS NULL) OR (actual_delivery >= shipment_date))),
    CONSTRAINT shipments_shipping_cost_check CHECK ((shipping_cost >= (0)::numeric))
);


ALTER TABLE public.shipments OWNER TO postgres;

--
-- TOC entry 235 (class 1259 OID 17109)
-- Name: tasks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tasks (
    task_id uuid DEFAULT gen_random_uuid() NOT NULL,
    business_rule_id uuid NOT NULL,
    order_id uuid,
    shipment_id uuid,
    return_id uuid,
    quality_claim_id uuid,
    assigned_to uuid,
    task_type character varying(50) NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    status character varying(20) DEFAULT 'new'::character varying,
    priority integer DEFAULT 3,
    due_date timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    result_notes text,
    completion_rating integer,
    auto_created boolean DEFAULT false,
    next_follow_up timestamp without time zone,
    CONSTRAINT tasks_check CHECK (((completed_at IS NULL) OR (completed_at >= started_at))),
    CONSTRAINT tasks_check1 CHECK (((started_at IS NULL) OR (started_at >= created_at))),
    CONSTRAINT tasks_check2 CHECK (((order_id IS NOT NULL) OR (shipment_id IS NOT NULL) OR (return_id IS NOT NULL) OR (quality_claim_id IS NOT NULL))),
    CONSTRAINT tasks_completion_rating_check CHECK (((completion_rating >= 1) AND (completion_rating <= 5))),
    CONSTRAINT tasks_priority_check CHECK (((priority >= 1) AND (priority <= 5)))
);


ALTER TABLE public.tasks OWNER TO postgres;

--
-- TOC entry 5425 (class 0 OID 0)
-- Dependencies: 235
-- Name: TABLE tasks; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.tasks IS '‡ ¤ зЁ,  ўв®¬ вЁзҐбЄЁ б®§¤ ў Ґ¬лҐ ­  ®б­®ўҐ ЎЁ§­Ґб-Їа ўЁ«';


--
-- TOC entry 5426 (class 0 OID 0)
-- Dependencies: 235
-- Name: COLUMN tasks.business_rule_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tasks.business_rule_id IS 'ЋЎп§ вҐ«м­ п бўп§м б ЎЁ§­Ґб-Їа ўЁ«®¬, ­  ®б­®ўҐ Є®в®а®Ј® б®§¤ ­  § ¤ з ';


--
-- TOC entry 5427 (class 0 OID 0)
-- Dependencies: 235
-- Name: COLUMN tasks.auto_created; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tasks.auto_created IS '”« Ј  ўв®¬ вЁзҐбЄ®Ј® б®§¤ ­Ёп § ¤ зЁ Ї® ЎЁ§­Ґб-Їа ўЁ«г';


--
-- TOC entry 5428 (class 0 OID 0)
-- Dependencies: 235
-- Name: COLUMN tasks.next_follow_up; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tasks.next_follow_up IS '„ в  б«Ґ¤гойҐЈ® Є®­ва®«п ўлЇ®«­Ґ­Ёп § ¤ зЁ';


--
-- TOC entry 246 (class 1259 OID 41667)
-- Name: shipment_tasks_view; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.shipment_tasks_view AS
 SELECT s.shipment_id,
    s.tracking_number,
    s.status AS shipment_status,
    s.estimated_delivery,
    s.actual_delivery,
    s.assigned_employee_id,
    concat(u.first_name, ' ', u.last_name) AS courier_name,
    o.order_number,
    o.order_date,
        CASE
            WHEN (ua.address_id IS NOT NULL) THEN ((((((ua.city)::text || ', г«. '::text) || (ua.street)::text) || ', ¤. '::text) || (ua.house)::text) || COALESCE((', Єў. '::text || NULLIF((ua.apartment)::text, ''::text)), ''::text))
            ELSE 'Ђ¤аҐб ­Ґ гЄ § ­'::text
        END AS delivery_address,
    t.task_id,
    t.title AS task_title,
    t.status AS task_status
   FROM (((((public.shipments s
     JOIN public.orders o ON ((s.order_id = o.order_id)))
     LEFT JOIN public.tasks t ON ((t.shipment_id = s.shipment_id)))
     LEFT JOIN public.employees e ON ((s.assigned_employee_id = e.employee_id)))
     LEFT JOIN public.users u ON ((e.user_id = u.user_id)))
     LEFT JOIN public.user_addresses ua ON ((s.delivery_address_id = ua.address_id)));


ALTER VIEW public.shipment_tasks_view OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16580)
-- Name: sizes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sizes (
    size_id uuid DEFAULT gen_random_uuid() NOT NULL,
    size_value character varying(20) NOT NULL,
    size_type character varying(20),
    sort_order integer DEFAULT 0,
    description character varying(100),
    created_at timestamp without time zone DEFAULT now(),
    is_active boolean DEFAULT true
);


ALTER TABLE public.sizes OWNER TO postgres;

--
-- TOC entry 231 (class 1259 OID 16912)
-- Name: system_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_logs (
    log_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    entity_type character varying(50),
    entity_id uuid,
    old_values jsonb,
    new_values jsonb,
    ip_address character varying(45),
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.system_logs OWNER TO postgres;

--
-- TOC entry 5177 (class 2606 OID 33431)
-- Name: auth_group auth_group_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_group
    ADD CONSTRAINT auth_group_name_key UNIQUE (name);


--
-- TOC entry 5182 (class 2606 OID 33416)
-- Name: auth_group_permissions auth_group_permissions_group_id_permission_id_0cd325b0_uniq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_group_permissions
    ADD CONSTRAINT auth_group_permissions_group_id_permission_id_0cd325b0_uniq UNIQUE (group_id, permission_id);


--
-- TOC entry 5185 (class 2606 OID 33405)
-- Name: auth_group_permissions auth_group_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_group_permissions
    ADD CONSTRAINT auth_group_permissions_pkey PRIMARY KEY (id);


--
-- TOC entry 5179 (class 2606 OID 33394)
-- Name: auth_group auth_group_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_group
    ADD CONSTRAINT auth_group_pkey PRIMARY KEY (id);


--
-- TOC entry 5172 (class 2606 OID 33407)
-- Name: auth_permission auth_permission_content_type_id_codename_01ab375a_uniq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_permission
    ADD CONSTRAINT auth_permission_content_type_id_codename_01ab375a_uniq UNIQUE (content_type_id, codename);


--
-- TOC entry 5174 (class 2606 OID 33386)
-- Name: auth_permission auth_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_permission
    ADD CONSTRAINT auth_permission_pkey PRIMARY KEY (id);


--
-- TOC entry 5076 (class 2606 OID 16579)
-- Name: brands brands_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_name_key UNIQUE (name);


--
-- TOC entry 5078 (class 2606 OID 16577)
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (brand_id);


--
-- TOC entry 5145 (class 2606 OID 17049)
-- Name: business_rules business_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.business_rules
    ADD CONSTRAINT business_rules_pkey PRIMARY KEY (rule_id);


--
-- TOC entry 5193 (class 2606 OID 41589)
-- Name: cart_items cart_items_cart_id_product_id_variant_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_cart_id_product_id_variant_id_key UNIQUE (cart_id, product_id, variant_id);


--
-- TOC entry 5195 (class 2606 OID 41587)
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_pkey PRIMARY KEY (cart_item_id);


--
-- TOC entry 5187 (class 2606 OID 41554)
-- Name: cart cart_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cart
    ADD CONSTRAINT cart_pkey PRIMARY KEY (cart_id);


--
-- TOC entry 5189 (class 2606 OID 41556)
-- Name: cart cart_user_id_session_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cart
    ADD CONSTRAINT cart_user_id_session_id_key UNIQUE (user_id, session_id);


--
-- TOC entry 5072 (class 2606 OID 16560)
-- Name: categories categories_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_name_key UNIQUE (name);


--
-- TOC entry 5074 (class 2606 OID 16558)
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (category_id);


--
-- TOC entry 5082 (class 2606 OID 16600)
-- Name: colors colors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.colors
    ADD CONSTRAINT colors_pkey PRIMARY KEY (color_id);


--
-- TOC entry 5134 (class 2606 OID 16869)
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (employee_id);


--
-- TOC entry 5136 (class 2606 OID 16871)
-- Name: employees employees_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_user_id_key UNIQUE (user_id);


--
-- TOC entry 5127 (class 2606 OID 16780)
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (notification_id);


--
-- TOC entry 5122 (class 2606 OID 16736)
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (order_item_id);


--
-- TOC entry 5208 (class 2606 OID 49777)
-- Name: order_status_history order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_pkey PRIMARY KEY (history_id);


--
-- TOC entry 5115 (class 2606 OID 16717)
-- Name: orders orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);


--
-- TOC entry 5117 (class 2606 OID 16715)
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (order_id);


--
-- TOC entry 5103 (class 2606 OID 16676)
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (variant_id);


--
-- TOC entry 5105 (class 2606 OID 16680)
-- Name: product_variants product_variants_product_id_size_id_color_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_size_id_color_id_key UNIQUE (product_id, size_id, color_id);


--
-- TOC entry 5107 (class 2606 OID 16678)
-- Name: product_variants product_variants_sku_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_sku_key UNIQUE (sku);


--
-- TOC entry 5093 (class 2606 OID 16638)
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (product_id);


--
-- TOC entry 5095 (class 2606 OID 16640)
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);


--
-- TOC entry 5132 (class 2606 OID 16831)
-- Name: quality_claims quality_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quality_claims
    ADD CONSTRAINT quality_claims_pkey PRIMARY KEY (claim_id);


--
-- TOC entry 5154 (class 2606 OID 17068)
-- Name: returns returns_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_pkey PRIMARY KEY (return_id);


--
-- TOC entry 5143 (class 2606 OID 16983)
-- Name: shipments shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (shipment_id);


--
-- TOC entry 5080 (class 2606 OID 16589)
-- Name: sizes sizes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sizes
    ADD CONSTRAINT sizes_pkey PRIMARY KEY (size_id);


--
-- TOC entry 5138 (class 2606 OID 16922)
-- Name: system_logs system_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_pkey PRIMARY KEY (log_id);


--
-- TOC entry 5169 (class 2606 OID 17129)
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (task_id);


--
-- TOC entry 5204 (class 2606 OID 41623)
-- Name: user_addresses user_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT user_addresses_pkey PRIMARY KEY (address_id);


--
-- TOC entry 5084 (class 2606 OID 16618)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 5086 (class 2606 OID 16616)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- TOC entry 5175 (class 1259 OID 33432)
-- Name: auth_group_name_a6ea08ec_like; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX auth_group_name_a6ea08ec_like ON public.auth_group USING btree (name varchar_pattern_ops);


--
-- TOC entry 5180 (class 1259 OID 33427)
-- Name: auth_group_permissions_group_id_b120cbf9; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX auth_group_permissions_group_id_b120cbf9 ON public.auth_group_permissions USING btree (group_id);


--
-- TOC entry 5183 (class 1259 OID 33428)
-- Name: auth_group_permissions_permission_id_84c5c92e; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX auth_group_permissions_permission_id_84c5c92e ON public.auth_group_permissions USING btree (permission_id);


--
-- TOC entry 5170 (class 1259 OID 33413)
-- Name: auth_permission_content_type_id_2f476e4b; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX auth_permission_content_type_id_2f476e4b ON public.auth_permission USING btree (content_type_id);


--
-- TOC entry 5146 (class 1259 OID 17052)
-- Name: idx_business_rules_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_business_rules_active ON public.business_rules USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 5147 (class 1259 OID 17053)
-- Name: idx_business_rules_effective; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_business_rules_effective ON public.business_rules USING btree (effective_from, effective_to);


--
-- TOC entry 5148 (class 1259 OID 17051)
-- Name: idx_business_rules_entity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_business_rules_entity ON public.business_rules USING btree (applies_to_entity, applies_to_entity_id);


--
-- TOC entry 5149 (class 1259 OID 17050)
-- Name: idx_business_rules_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_business_rules_type ON public.business_rules USING btree (rule_type);


--
-- TOC entry 5196 (class 1259 OID 41606)
-- Name: idx_cart_items_cart; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cart_items_cart ON public.cart_items USING btree (cart_id);


--
-- TOC entry 5197 (class 1259 OID 41607)
-- Name: idx_cart_items_product; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cart_items_product ON public.cart_items USING btree (product_id);


--
-- TOC entry 5198 (class 1259 OID 41608)
-- Name: idx_cart_items_variant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cart_items_variant ON public.cart_items USING btree (variant_id);


--
-- TOC entry 5190 (class 1259 OID 41571)
-- Name: idx_cart_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cart_session ON public.cart USING btree (session_id);


--
-- TOC entry 5191 (class 1259 OID 41570)
-- Name: idx_cart_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cart_user ON public.cart USING btree (user_id);


--
-- TOC entry 5128 (class 1259 OID 16956)
-- Name: idx_claims_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_claims_order ON public.quality_claims USING btree (order_id);


--
-- TOC entry 5129 (class 1259 OID 16958)
-- Name: idx_claims_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_claims_status ON public.quality_claims USING btree (status);


--
-- TOC entry 5130 (class 1259 OID 16957)
-- Name: idx_claims_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_claims_user ON public.quality_claims USING btree (user_id);


--
-- TOC entry 5123 (class 1259 OID 16951)
-- Name: idx_notifications_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_order ON public.notifications USING btree (order_id);


--
-- TOC entry 5124 (class 1259 OID 16952)
-- Name: idx_notifications_sent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_sent ON public.notifications USING btree (sent_at);


--
-- TOC entry 5125 (class 1259 OID 16950)
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id);


--
-- TOC entry 5118 (class 1259 OID 16944)
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);


--
-- TOC entry 5119 (class 1259 OID 16945)
-- Name: idx_order_items_product; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_product ON public.order_items USING btree (product_id);


--
-- TOC entry 5120 (class 1259 OID 16946)
-- Name: idx_order_items_variant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_variant ON public.order_items USING btree (variant_id);


--
-- TOC entry 5205 (class 1259 OID 49789)
-- Name: idx_order_status_history_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_status_history_date ON public.order_status_history USING btree (created_at);


--
-- TOC entry 5206 (class 1259 OID 49788)
-- Name: idx_order_status_history_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_status_history_order ON public.order_status_history USING btree (order_id);


--
-- TOC entry 5108 (class 1259 OID 16943)
-- Name: idx_orders_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_created ON public.orders USING btree (created_at);


--
-- TOC entry 5109 (class 1259 OID 16941)
-- Name: idx_orders_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_date ON public.orders USING btree (order_date);


--
-- TOC entry 5110 (class 1259 OID 17098)
-- Name: idx_orders_next_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_next_status ON public.orders USING btree (next_status_update) WHERE (next_status_update IS NOT NULL);


--
-- TOC entry 5111 (class 1259 OID 16942)
-- Name: idx_orders_payment_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_payment_status ON public.orders USING btree (payment_status);


--
-- TOC entry 5112 (class 1259 OID 16940)
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- TOC entry 5113 (class 1259 OID 16939)
-- Name: idx_orders_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_user ON public.orders USING btree (user_id);


--
-- TOC entry 5087 (class 1259 OID 16930)
-- Name: idx_products_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_active ON public.products USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 5088 (class 1259 OID 16929)
-- Name: idx_products_brand; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_brand ON public.products USING btree (brand_id);


--
-- TOC entry 5089 (class 1259 OID 16928)
-- Name: idx_products_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_category ON public.products USING btree (category_id);


--
-- TOC entry 5090 (class 1259 OID 16932)
-- Name: idx_products_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_created ON public.products USING btree (created_at);


--
-- TOC entry 5091 (class 1259 OID 16931)
-- Name: idx_products_price; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_products_price ON public.products USING btree (base_price) WHERE (is_active = true);


--
-- TOC entry 5150 (class 1259 OID 17089)
-- Name: idx_returns_business_rule; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_returns_business_rule ON public.returns USING btree (business_rule_id);


--
-- TOC entry 5151 (class 1259 OID 17090)
-- Name: idx_returns_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_returns_order ON public.returns USING btree (order_id);


--
-- TOC entry 5152 (class 1259 OID 17091)
-- Name: idx_returns_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_returns_status ON public.returns USING btree (status);


--
-- TOC entry 5139 (class 1259 OID 16994)
-- Name: idx_shipments_employee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_shipments_employee ON public.shipments USING btree (assigned_employee_id);


--
-- TOC entry 5140 (class 1259 OID 16996)
-- Name: idx_shipments_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_shipments_order ON public.shipments USING btree (order_id);


--
-- TOC entry 5141 (class 1259 OID 16995)
-- Name: idx_shipments_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_shipments_status ON public.shipments USING btree (status);


--
-- TOC entry 5155 (class 1259 OID 17161)
-- Name: idx_tasks_assigned_to; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_assigned_to ON public.tasks USING btree (assigned_to);


--
-- TOC entry 5156 (class 1259 OID 17170)
-- Name: idx_tasks_auto_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_auto_created ON public.tasks USING btree (auto_created) WHERE (auto_created = true);


--
-- TOC entry 5157 (class 1259 OID 17160)
-- Name: idx_tasks_business_rule; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_business_rule ON public.tasks USING btree (business_rule_id);


--
-- TOC entry 5158 (class 1259 OID 17165)
-- Name: idx_tasks_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_created_at ON public.tasks USING btree (created_at);


--
-- TOC entry 5159 (class 1259 OID 17164)
-- Name: idx_tasks_due_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_due_date ON public.tasks USING btree (due_date);


--
-- TOC entry 5160 (class 1259 OID 17171)
-- Name: idx_tasks_next_follow_up; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_next_follow_up ON public.tasks USING btree (next_follow_up) WHERE (next_follow_up IS NOT NULL);


--
-- TOC entry 5161 (class 1259 OID 17166)
-- Name: idx_tasks_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_order ON public.tasks USING btree (order_id) WHERE (order_id IS NOT NULL);


--
-- TOC entry 5162 (class 1259 OID 17163)
-- Name: idx_tasks_priority; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_priority ON public.tasks USING btree (priority);


--
-- TOC entry 5163 (class 1259 OID 17169)
-- Name: idx_tasks_quality_claim; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_quality_claim ON public.tasks USING btree (quality_claim_id) WHERE (quality_claim_id IS NOT NULL);


--
-- TOC entry 5164 (class 1259 OID 17168)
-- Name: idx_tasks_return; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_return ON public.tasks USING btree (return_id) WHERE (return_id IS NOT NULL);


--
-- TOC entry 5165 (class 1259 OID 17167)
-- Name: idx_tasks_shipment; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_shipment ON public.tasks USING btree (shipment_id) WHERE (shipment_id IS NOT NULL);


--
-- TOC entry 5166 (class 1259 OID 17162)
-- Name: idx_tasks_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_status ON public.tasks USING btree (status);


--
-- TOC entry 5167 (class 1259 OID 17172)
-- Name: idx_tasks_type_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tasks_type_status ON public.tasks USING btree (task_type, status);


--
-- TOC entry 5199 (class 1259 OID 41632)
-- Name: idx_user_addresses_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_addresses_active ON public.user_addresses USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 5200 (class 1259 OID 41630)
-- Name: idx_user_addresses_default; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_addresses_default ON public.user_addresses USING btree (user_id) WHERE (is_default = true);


--
-- TOC entry 5201 (class 1259 OID 41631)
-- Name: idx_user_addresses_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_addresses_type ON public.user_addresses USING btree (user_id, address_type);


--
-- TOC entry 5202 (class 1259 OID 41629)
-- Name: idx_user_addresses_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_addresses_user ON public.user_addresses USING btree (user_id);


--
-- TOC entry 5096 (class 1259 OID 16937)
-- Name: idx_variants_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_variants_active ON public.product_variants USING btree (is_active) WHERE (is_active = true);


--
-- TOC entry 5097 (class 1259 OID 16938)
-- Name: idx_variants_available; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_variants_available ON public.product_variants USING btree (product_id, is_active, stock_quantity) WHERE ((is_active = true) AND (stock_quantity > 0));


--
-- TOC entry 5098 (class 1259 OID 16933)
-- Name: idx_variants_product; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_variants_product ON public.product_variants USING btree (product_id);


--
-- TOC entry 5099 (class 1259 OID 16934)
-- Name: idx_variants_size_color; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_variants_size_color ON public.product_variants USING btree (size_id, color_id);


--
-- TOC entry 5100 (class 1259 OID 16935)
-- Name: idx_variants_sku; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_variants_sku ON public.product_variants USING btree (sku);


--
-- TOC entry 5101 (class 1259 OID 16936)
-- Name: idx_variants_stock; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_variants_stock ON public.product_variants USING btree (stock_quantity) WHERE (stock_quantity > 0);


--
-- TOC entry 5257 (class 2620 OID 17177)
-- Name: orders trigger_auto_create_order_tasks; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_auto_create_order_tasks AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.auto_create_tasks_from_business_rules();


--
-- TOC entry 5260 (class 2620 OID 17175)
-- Name: quality_claims trigger_auto_create_quality_tasks; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_auto_create_quality_tasks AFTER INSERT ON public.quality_claims FOR EACH ROW EXECUTE FUNCTION public.auto_create_tasks_from_business_rules();


--
-- TOC entry 5266 (class 2620 OID 17174)
-- Name: returns trigger_auto_create_return_tasks; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_auto_create_return_tasks AFTER INSERT ON public.returns FOR EACH ROW EXECUTE FUNCTION public.auto_create_tasks_from_business_rules();


--
-- TOC entry 5261 (class 2620 OID 17176)
-- Name: shipments trigger_auto_create_shipment_tasks; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_auto_create_shipment_tasks AFTER INSERT ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.auto_create_tasks_from_business_rules();


--
-- TOC entry 5265 (class 2620 OID 17092)
-- Name: business_rules trigger_business_rules_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_business_rules_updated_at BEFORE UPDATE ON public.business_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5269 (class 2620 OID 41605)
-- Name: cart_items trigger_cart_items_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_cart_items_updated_at BEFORE UPDATE ON public.cart_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5268 (class 2620 OID 41569)
-- Name: cart trigger_cart_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_cart_updated_at BEFORE UPDATE ON public.cart FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5262 (class 2620 OID 41655)
-- Name: shipments trigger_create_shipment_task; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_create_shipment_task BEFORE INSERT ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.create_shipment_task();


--
-- TOC entry 5258 (class 2620 OID 17100)
-- Name: orders trigger_order_status_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_order_status_change AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.handle_order_status_change();


--
-- TOC entry 5259 (class 2620 OID 16965)
-- Name: orders trigger_orders_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5255 (class 2620 OID 16963)
-- Name: products trigger_products_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5267 (class 2620 OID 17096)
-- Name: returns trigger_returns_create_tasks; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_returns_create_tasks AFTER INSERT ON public.returns FOR EACH ROW EXECUTE FUNCTION public.create_tasks_from_business_rules();


--
-- TOC entry 5263 (class 2620 OID 17095)
-- Name: shipments trigger_shipments_create_tasks; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_shipments_create_tasks AFTER INSERT ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.create_tasks_from_business_rules();


--
-- TOC entry 5264 (class 2620 OID 17093)
-- Name: shipments trigger_shipments_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_shipments_updated_at BEFORE UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5270 (class 2620 OID 41633)
-- Name: user_addresses trigger_user_addresses_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_user_addresses_updated_at BEFORE UPDATE ON public.user_addresses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5256 (class 2620 OID 16964)
-- Name: product_variants trigger_variants_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_variants_updated_at BEFORE UPDATE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- TOC entry 5246 (class 2606 OID 33422)
-- Name: auth_group_permissions auth_group_permissio_permission_id_84c5c92e_fk_auth_perm; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_group_permissions
    ADD CONSTRAINT auth_group_permissio_permission_id_84c5c92e_fk_auth_perm FOREIGN KEY (permission_id) REFERENCES public.auth_permission(id) DEFERRABLE INITIALLY DEFERRED;


--
-- TOC entry 5247 (class 2606 OID 33417)
-- Name: auth_group_permissions auth_group_permissions_group_id_b120cbf9_fk_auth_group_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_group_permissions
    ADD CONSTRAINT auth_group_permissions_group_id_b120cbf9_fk_auth_group_id FOREIGN KEY (group_id) REFERENCES public.auth_group(id) DEFERRABLE INITIALLY DEFERRED;


--
-- TOC entry 5249 (class 2606 OID 41590)
-- Name: cart_items cart_items_cart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES public.cart(cart_id) ON DELETE CASCADE;


--
-- TOC entry 5250 (class 2606 OID 41595)
-- Name: cart_items cart_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(product_id) ON DELETE CASCADE;


--
-- TOC entry 5251 (class 2606 OID 41600)
-- Name: cart_items cart_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(variant_id) ON DELETE SET NULL;


--
-- TOC entry 5248 (class 2606 OID 41557)
-- Name: cart cart_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cart
    ADD CONSTRAINT cart_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- TOC entry 5209 (class 2606 OID 16561)
-- Name: categories categories_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(category_id);


--
-- TOC entry 5228 (class 2606 OID 25165)
-- Name: employees employees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- TOC entry 5221 (class 2606 OID 16786)
-- Name: notifications notifications_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id);


--
-- TOC entry 5222 (class 2606 OID 16781)
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- TOC entry 5218 (class 2606 OID 16737)
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id) ON DELETE CASCADE;


--
-- TOC entry 5219 (class 2606 OID 16742)
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(product_id);


--
-- TOC entry 5220 (class 2606 OID 16747)
-- Name: order_items order_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(variant_id);


--
-- TOC entry 5253 (class 2606 OID 49783)
-- Name: order_status_history order_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(user_id);


--
-- TOC entry 5254 (class 2606 OID 49778)
-- Name: order_status_history order_status_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id) ON DELETE CASCADE;


--
-- TOC entry 5215 (class 2606 OID 41639)
-- Name: orders orders_billing_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_billing_address_id_fkey FOREIGN KEY (billing_address_id) REFERENCES public.user_addresses(address_id);


--
-- TOC entry 5216 (class 2606 OID 41634)
-- Name: orders orders_shipping_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_shipping_address_id_fkey FOREIGN KEY (shipping_address_id) REFERENCES public.user_addresses(address_id);


--
-- TOC entry 5217 (class 2606 OID 25160)
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- TOC entry 5212 (class 2606 OID 16691)
-- Name: product_variants product_variants_color_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_color_id_fkey FOREIGN KEY (color_id) REFERENCES public.colors(color_id);


--
-- TOC entry 5213 (class 2606 OID 16681)
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(product_id) ON DELETE CASCADE;


--
-- TOC entry 5214 (class 2606 OID 16686)
-- Name: product_variants product_variants_size_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_size_id_fkey FOREIGN KEY (size_id) REFERENCES public.sizes(size_id);


--
-- TOC entry 5210 (class 2606 OID 16646)
-- Name: products products_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(brand_id);


--
-- TOC entry 5211 (class 2606 OID 16641)
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(category_id);


--
-- TOC entry 5223 (class 2606 OID 16852)
-- Name: quality_claims quality_claims_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quality_claims
    ADD CONSTRAINT quality_claims_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(user_id);


--
-- TOC entry 5224 (class 2606 OID 16832)
-- Name: quality_claims quality_claims_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quality_claims
    ADD CONSTRAINT quality_claims_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id);


--
-- TOC entry 5225 (class 2606 OID 16842)
-- Name: quality_claims quality_claims_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quality_claims
    ADD CONSTRAINT quality_claims_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(product_id);


--
-- TOC entry 5226 (class 2606 OID 16837)
-- Name: quality_claims quality_claims_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quality_claims
    ADD CONSTRAINT quality_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- TOC entry 5227 (class 2606 OID 16847)
-- Name: quality_claims quality_claims_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quality_claims
    ADD CONSTRAINT quality_claims_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(variant_id);


--
-- TOC entry 5234 (class 2606 OID 17084)
-- Name: returns returns_business_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_business_rule_id_fkey FOREIGN KEY (business_rule_id) REFERENCES public.business_rules(rule_id);


--
-- TOC entry 5235 (class 2606 OID 17069)
-- Name: returns returns_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id);


--
-- TOC entry 5236 (class 2606 OID 41661)
-- Name: returns returns_pickup_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_pickup_address_id_fkey FOREIGN KEY (pickup_address_id) REFERENCES public.user_addresses(address_id);


--
-- TOC entry 5237 (class 2606 OID 41656)
-- Name: returns returns_return_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_return_address_id_fkey FOREIGN KEY (return_address_id) REFERENCES public.user_addresses(address_id);


--
-- TOC entry 5238 (class 2606 OID 17074)
-- Name: returns returns_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- TOC entry 5239 (class 2606 OID 17079)
-- Name: returns returns_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.returns
    ADD CONSTRAINT returns_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(variant_id);


--
-- TOC entry 5230 (class 2606 OID 16989)
-- Name: shipments shipments_assigned_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_assigned_employee_id_fkey FOREIGN KEY (assigned_employee_id) REFERENCES public.employees(employee_id);


--
-- TOC entry 5231 (class 2606 OID 17104)
-- Name: shipments shipments_business_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_business_rule_id_fkey FOREIGN KEY (business_rule_id) REFERENCES public.business_rules(rule_id);


--
-- TOC entry 5232 (class 2606 OID 41649)
-- Name: shipments shipments_delivery_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_delivery_address_id_fkey FOREIGN KEY (delivery_address_id) REFERENCES public.user_addresses(address_id);


--
-- TOC entry 5233 (class 2606 OID 16984)
-- Name: shipments shipments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id);


--
-- TOC entry 5229 (class 2606 OID 16923)
-- Name: system_logs system_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- TOC entry 5240 (class 2606 OID 17155)
-- Name: tasks tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.employees(employee_id);


--
-- TOC entry 5241 (class 2606 OID 17130)
-- Name: tasks tasks_business_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_business_rule_id_fkey FOREIGN KEY (business_rule_id) REFERENCES public.business_rules(rule_id);


--
-- TOC entry 5242 (class 2606 OID 17135)
-- Name: tasks tasks_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id);


--
-- TOC entry 5243 (class 2606 OID 17150)
-- Name: tasks tasks_quality_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_quality_claim_id_fkey FOREIGN KEY (quality_claim_id) REFERENCES public.quality_claims(claim_id);


--
-- TOC entry 5244 (class 2606 OID 17145)
-- Name: tasks tasks_return_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_return_id_fkey FOREIGN KEY (return_id) REFERENCES public.returns(return_id);


--
-- TOC entry 5245 (class 2606 OID 17140)
-- Name: tasks tasks_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(shipment_id);


--
-- TOC entry 5252 (class 2606 OID 41624)
-- Name: user_addresses user_addresses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_addresses
    ADD CONSTRAINT user_addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


-- Completed on 2026-11-15 22:15:22

--
-- PostgreSQL database dump complete
--

\unrestrict bPdbRmfN6fXkzKtlmKfGdNwC86Ru0avcmnsSavrEv8YQ1aOeZ7YtcYNeOb6fL9H

