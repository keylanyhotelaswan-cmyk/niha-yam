export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          branch_id: string | null
          correlation_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          new_data: Json | null
          old_data: Json | null
          restaurant_id: string | null
          staff_id: string | null
        }
        Insert: {
          action: string
          branch_id?: string | null
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          restaurant_id?: string | null
          staff_id?: string | null
        }
        Update: {
          action?: string
          branch_id?: string | null
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          restaurant_id?: string | null
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          address_line: string
          created_at: string
          customer_id: string
          delivery_zone: string | null
          id: string
          is_default: boolean
          label: string
          metadata: Json
          restaurant_id: string
        }
        Insert: {
          address_line: string
          created_at?: string
          customer_id: string
          delivery_zone?: string | null
          id?: string
          is_default?: boolean
          label?: string
          metadata?: Json
          restaurant_id: string
        }
        Update: {
          address_line?: string
          created_at?: string
          customer_id?: string
          delivery_zone?: string | null
          id?: string
          is_default?: boolean
          label?: string
          metadata?: Json
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_phones: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          is_primary: boolean
          label: string
          phone_normalized: string
          phone_raw: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          is_primary?: boolean
          label?: string
          phone_normalized: string
          phone_raw: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          is_primary?: boolean
          label?: string
          phone_normalized?: string
          phone_raw?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_phones_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_phones_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          display_name: string
          id: string
          loyalty_metadata: Json
          notes: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          loyalty_metadata?: Json
          notes?: string | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          loyalty_metadata?: Json
          notes?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_drivers: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          metadata: Json
          notes: string | null
          phone: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          metadata?: Json
          notes?: string | null
          phone?: string | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          notes?: string | null
          phone?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_drivers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          auto_approved: boolean
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          created_by: string | null
          description: string | null
          executed_at: string | null
          id: string
          reference: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          restaurant_id: string
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          reverses_id: string | null
          shift_id: string | null
          status: Database["public"]["Enums"]["fin_status"]
          treasury_id: string
          vendor: string | null
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          category: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          executed_at?: string | null
          id?: string
          reference: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          restaurant_id: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reverses_id?: string | null
          shift_id?: string | null
          status?: Database["public"]["Enums"]["fin_status"]
          treasury_id: string
          vendor?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          executed_at?: string | null
          id?: string
          reference?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          restaurant_id?: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reverses_id?: string | null
          shift_id?: string | null
          status?: Database["public"]["Enums"]["fin_status"]
          treasury_id?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_reverses_id_fkey"
            columns: ["reverses_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_treasury_id_fkey"
            columns: ["treasury_id"]
            isOneToOne: false
            referencedRelation: "treasuries"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_ref_counters: {
        Row: {
          current_value: number
          ref_type: string
          restaurant_id: string
        }
        Insert: {
          current_value?: number
          ref_type: string
          restaurant_id: string
        }
        Update: {
          current_value?: number
          ref_type?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_ref_counters_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_cost_changes: {
        Row: {
          changed_at: string
          changed_by: string | null
          cost_mode: Database["public"]["Enums"]["ingredient_cost_mode"]
          id: string
          ingredient_id: string
          new_standard_cost: number
          note: string | null
          old_standard_cost: number | null
          restaurant_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          cost_mode: Database["public"]["Enums"]["ingredient_cost_mode"]
          id?: string
          ingredient_id: string
          new_standard_cost: number
          note?: string | null
          old_standard_cost?: number | null
          restaurant_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          cost_mode?: Database["public"]["Enums"]["ingredient_cost_mode"]
          id?: string
          ingredient_id?: string
          new_standard_cost?: number
          note?: string | null
          old_standard_cost?: number | null
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_cost_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_cost_changes_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_cost_changes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_stock_settings: {
        Row: {
          allow_negative: boolean
          ingredient_id: string
          reorder_level: number
          restaurant_id: string
          signal_high_waste: boolean
          signal_low_stock: boolean
          signal_no_movement: boolean
          updated_at: string
        }
        Insert: {
          allow_negative?: boolean
          ingredient_id: string
          reorder_level?: number
          restaurant_id: string
          signal_high_waste?: boolean
          signal_low_stock?: boolean
          signal_no_movement?: boolean
          updated_at?: string
        }
        Update: {
          allow_negative?: boolean
          ingredient_id?: string
          reorder_level?: number
          restaurant_id?: string
          signal_high_waste?: boolean
          signal_low_stock?: boolean
          signal_no_movement?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_stock_settings_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: true
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_stock_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          base_uom_id: string
          code: string | null
          cost_mode: Database["public"]["Enums"]["ingredient_cost_mode"]
          created_at: string
          id: string
          is_active: boolean
          name_ar: string
          name_en: string | null
          restaurant_id: string
          standard_cost: number
          updated_at: string
        }
        Insert: {
          base_uom_id: string
          code?: string | null
          cost_mode?: Database["public"]["Enums"]["ingredient_cost_mode"]
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar: string
          name_en?: string | null
          restaurant_id: string
          standard_cost?: number
          updated_at?: string
        }
        Update: {
          base_uom_id?: string
          code?: string | null
          cost_mode?: Database["public"]["Enums"]["ingredient_cost_mode"]
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string | null
          restaurant_id?: string
          standard_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_base_uom_id_fkey"
            columns: ["base_uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredients_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_ticket_lines: {
        Row: {
          id: string
          line_note: string | null
          modifier_summary: string | null
          name: string
          order_item_id: string
          quantity: number
          sort_order: number
          status: Database["public"]["Enums"]["kitchen_line_status"]
          ticket_id: string
        }
        Insert: {
          id?: string
          line_note?: string | null
          modifier_summary?: string | null
          name: string
          order_item_id: string
          quantity: number
          sort_order?: number
          status?: Database["public"]["Enums"]["kitchen_line_status"]
          ticket_id: string
        }
        Update: {
          id?: string
          line_note?: string | null
          modifier_summary?: string | null
          name?: string
          order_item_id?: string
          quantity?: number
          sort_order?: number
          status?: Database["public"]["Enums"]["kitchen_line_status"]
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_ticket_lines_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_ticket_lines_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "kitchen_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_tickets: {
        Row: {
          created_at: string
          id: string
          order_id: string
          reference: string
          restaurant_id: string
          shift_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          reference: string
          restaurant_id: string
          shift_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          reference?: string
          restaurant_id?: string
          shift_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_tickets_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_tickets_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      liquidity_allocations: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          kind: string
          reason: string | null
          restaurant_id: string
          source_ref_id: string | null
          source_ref_type: string | null
          treasury_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          reason?: string | null
          restaurant_id: string
          source_ref_id?: string | null
          source_ref_type?: string | null
          treasury_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          reason?: string | null
          restaurant_id?: string
          source_ref_id?: string | null
          source_ref_type?: string | null
          treasury_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "liquidity_allocations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liquidity_allocations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liquidity_allocations_treasury_id_fkey"
            columns: ["treasury_id"]
            isOneToOne: false
            referencedRelation: "treasuries"
            referencedColumns: ["id"]
          },
        ]
      }
      liquidity_settings: {
        Row: {
          operating_pct: number
          reserved_pct: number
          restaurant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          operating_pct?: number
          reserved_pct?: number
          restaurant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          operating_pct?: number
          reserved_pct?: number
          restaurant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "liquidity_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "liquidity_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          restaurant_id: string
          show_in_pos: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          restaurant_id: string
          show_in_pos?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          restaurant_id?: string
          show_in_pos?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_modifier_groups: {
        Row: {
          menu_item_id: string
          modifier_group_id: string
          sort_order: number
        }
        Insert: {
          menu_item_id: string
          modifier_group_id: string
          sort_order?: number
        }
        Update: {
          menu_item_id?: string
          modifier_group_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_modifier_groups_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_modifier_groups_modifier_group_id_fkey"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          accepts_modifiers: boolean
          allows_discounts: boolean
          base_price: number
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_favorite: boolean
          is_open_price: boolean
          name: string
          needs_kitchen: boolean
          needs_print: boolean
          restaurant_id: string
          show_in_pos: boolean
          sku: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          accepts_modifiers?: boolean
          allows_discounts?: boolean
          base_price?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_favorite?: boolean
          is_open_price?: boolean
          name: string
          needs_kitchen?: boolean
          needs_print?: boolean
          restaurant_id: string
          show_in_pos?: boolean
          sku?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          accepts_modifiers?: boolean
          allows_discounts?: boolean
          base_price?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_favorite?: boolean
          is_open_price?: boolean
          name?: string
          needs_kitchen?: boolean
          needs_print?: boolean
          restaurant_id?: string
          show_in_pos?: boolean
          sku?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          max_selections: number
          min_selections: number
          name: string
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_selections?: number
          min_selections?: number
          name: string
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_selections?: number
          min_selections?: number
          name?: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_groups_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_options: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          price_delta: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          price_delta?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          price_delta?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          channel: string
          created_at: string
          error_message: string | null
          event_key: string
          id: string
          payload: Json
          restaurant_id: string
          sent_at: string | null
          status: string
        }
        Insert: {
          channel: string
          created_at?: string
          error_message?: string | null
          event_key: string
          id?: string
          payload?: Json
          restaurant_id: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          channel?: string
          created_at?: string
          error_message?: string | null
          event_key?: string
          id?: string
          payload?: Json
          restaurant_id?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_feedback: {
        Row: {
          app_version: string | null
          body: string
          branch_id: string | null
          bridge_version: string | null
          closed_at: string | null
          context_id: string | null
          context_type: string | null
          created_at: string
          created_by: string
          device_label: string | null
          id: string
          image_path: string | null
          kind: string
          priority: string
          reference: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_in_version: string | null
          restaurant_id: string
          shift_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          app_version?: string | null
          body: string
          branch_id?: string | null
          bridge_version?: string | null
          closed_at?: string | null
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          created_by: string
          device_label?: string | null
          id?: string
          image_path?: string | null
          kind: string
          priority?: string
          reference: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_in_version?: string | null
          restaurant_id: string
          shift_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          app_version?: string | null
          body?: string
          branch_id?: string | null
          bridge_version?: string | null
          closed_at?: string | null
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          created_by?: string
          device_label?: string | null
          id?: string
          image_path?: string | null
          kind?: string
          priority?: string
          reference?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_in_version?: string | null
          restaurant_id?: string
          shift_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_feedback_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_feedback_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_feedback_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_feedback_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_feedback_comments: {
        Row: {
          body: string
          created_at: string
          created_by: string
          feedback_id: string
          id: string
          restaurant_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          feedback_id: string
          id?: string
          restaurant_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          feedback_id?: string
          id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_feedback_comments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_feedback_comments_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "ops_feedback"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_feedback_comments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_messages: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          print_job_id: string | null
          reference: string
          restaurant_id: string
          target_role: string | null
          target_station: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          print_job_id?: string | null
          reference: string
          restaurant_id: string
          target_role?: string | null
          target_station?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          print_job_id?: string | null
          reference?: string
          restaurant_id?: string
          target_role?: string | null
          target_station?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_messages_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_messages_print_job_id_fkey"
            columns: ["print_job_id"]
            isOneToOne: false
            referencedRelation: "print_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ops_messages_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_amendments: {
        Row: {
          amendment_type: string
          created_at: string
          created_by: string | null
          id: string
          order_id: string
          payload: Json
          restaurant_id: string
        }
        Insert: {
          amendment_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          order_id: string
          payload?: Json
          restaurant_id: string
        }
        Update: {
          amendment_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          order_id?: string
          payload?: Json
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_amendments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_amendments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_amendments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          order_id: string
          payload: Json
          restaurant_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          order_id: string
          payload?: Json
          restaurant_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          order_id?: string
          payload?: Json
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_modifiers: {
        Row: {
          group_name: string
          modifier_option_id: string | null
          option_name: string
          order_item_id: string
          price_delta: number
        }
        Insert: {
          group_name: string
          modifier_option_id?: string | null
          option_name: string
          order_item_id: string
          price_delta?: number
        }
        Update: {
          group_name?: string
          modifier_option_id?: string | null
          option_name?: string
          order_item_id?: string
          price_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_modifier_option_id_fkey"
            columns: ["modifier_option_id"]
            isOneToOne: false
            referencedRelation: "modifier_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_modifiers_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          is_open_price: boolean
          line_note: string | null
          line_total: number
          menu_item_id: string | null
          name: string
          needs_kitchen: boolean
          needs_print: boolean
          order_id: string
          quantity: number
          sku: string | null
          sort_order: number
          unit_price: number
        }
        Insert: {
          id?: string
          is_open_price?: boolean
          line_note?: string | null
          line_total: number
          menu_item_id?: string | null
          name: string
          needs_kitchen?: boolean
          needs_print?: boolean
          order_id: string
          quantity: number
          sku?: string | null
          sort_order?: number
          unit_price: number
        }
        Update: {
          id?: string
          is_open_price?: boolean
          line_note?: string | null
          line_total?: number
          menu_item_id?: string | null
          name?: string
          needs_kitchen?: boolean
          needs_print?: boolean
          order_id?: string
          quantity?: number
          sku?: string | null
          sort_order?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_payments: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          auto_approved: boolean
          change_given: number
          collection_status: Database["public"]["Enums"]["collection_status"]
          created_at: string
          created_by: string | null
          id: string
          net_amount: number | null
          order_id: string
          payment_method_id: string
          reference: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          reverses_id: string | null
          shift_id: string | null
          treasury_id: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          change_given?: number
          collection_status?: Database["public"]["Enums"]["collection_status"]
          created_at?: string
          created_by?: string | null
          id?: string
          net_amount?: number | null
          order_id: string
          payment_method_id: string
          reference: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reverses_id?: string | null
          shift_id?: string | null
          treasury_id: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          change_given?: number
          collection_status?: Database["public"]["Enums"]["collection_status"]
          created_at?: string
          created_by?: string | null
          id?: string
          net_amount?: number | null
          order_id?: string
          payment_method_id?: string
          reference?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reverses_id?: string | null
          shift_id?: string | null
          treasury_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_payments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_reverses_id_fkey"
            columns: ["reverses_id"]
            isOneToOne: false
            referencedRelation: "order_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_treasury_id_fkey"
            columns: ["treasury_id"]
            isOneToOne: false
            referencedRelation: "treasuries"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          client_request_id: string | null
          closed_at: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          delivery_address: string | null
          delivery_driver_id: string | null
          delivery_name: string | null
          delivery_notes: string | null
          delivery_phone: string | null
          delivery_zone: string | null
          dine_in_table_ref: string | null
          discount_amount: number
          discount_reason: string | null
          discount_type: Database["public"]["Enums"]["discount_type"] | null
          discount_value: number | null
          fulfillment_status: Database["public"]["Enums"]["order_fulfillment_status"]
          id: string
          last_edited_at: string | null
          last_edited_by: string | null
          metadata: Json
          order_note: string | null
          order_type: Database["public"]["Enums"]["pos_order_type"]
          payment_status: Database["public"]["Enums"]["order_payment_status"]
          print_status: Database["public"]["Enums"]["order_print_status"]
          promotions_snapshot: Json
          reference: string
          requires_review: boolean
          restaurant_id: string
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shift_id: string
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
        }
        Insert: {
          client_request_id?: string | null
          closed_at?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivery_address?: string | null
          delivery_driver_id?: string | null
          delivery_name?: string | null
          delivery_notes?: string | null
          delivery_phone?: string | null
          delivery_zone?: string | null
          dine_in_table_ref?: string | null
          discount_amount?: number
          discount_reason?: string | null
          discount_type?: Database["public"]["Enums"]["discount_type"] | null
          discount_value?: number | null
          fulfillment_status?: Database["public"]["Enums"]["order_fulfillment_status"]
          id?: string
          last_edited_at?: string | null
          last_edited_by?: string | null
          metadata?: Json
          order_note?: string | null
          order_type?: Database["public"]["Enums"]["pos_order_type"]
          payment_status?: Database["public"]["Enums"]["order_payment_status"]
          print_status?: Database["public"]["Enums"]["order_print_status"]
          promotions_snapshot?: Json
          reference: string
          requires_review?: boolean
          restaurant_id: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
        }
        Update: {
          client_request_id?: string | null
          closed_at?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivery_address?: string | null
          delivery_driver_id?: string | null
          delivery_name?: string | null
          delivery_notes?: string | null
          delivery_phone?: string | null
          delivery_zone?: string | null
          dine_in_table_ref?: string | null
          discount_amount?: number
          discount_reason?: string | null
          discount_type?: Database["public"]["Enums"]["discount_type"] | null
          discount_value?: number | null
          fulfillment_status?: Database["public"]["Enums"]["order_fulfillment_status"]
          id?: string
          last_edited_at?: string | null
          last_edited_by?: string | null
          metadata?: Json
          order_note?: string | null
          order_type?: Database["public"]["Enums"]["pos_order_type"]
          payment_status?: Database["public"]["Enums"]["order_payment_status"]
          print_status?: Database["public"]["Enums"]["order_print_status"]
          promotions_snapshot?: Json
          reference?: string
          requires_review?: boolean
          restaurant_id?: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_delivery_driver_id_fkey"
            columns: ["delivery_driver_id"]
            isOneToOne: false
            referencedRelation: "delivery_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_last_edited_by_fkey"
            columns: ["last_edited_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          restaurant_id: string
          sort_order: number
          treasury_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          restaurant_id: string
          sort_order?: number
          treasury_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          restaurant_id?: string
          sort_order?: number
          treasury_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_methods_treasury_id_fkey"
            columns: ["treasury_id"]
            isOneToOne: false
            referencedRelation: "treasuries"
            referencedColumns: ["id"]
          },
        ]
      }
      print_attempts: {
        Row: {
          attempt_no: number
          bridge_id: string | null
          delivery: Database["public"]["Enums"]["print_delivery"] | null
          error_code: string | null
          error_message: string | null
          finished_at: string | null
          id: string
          print_job_id: string
          restaurant_id: string
          started_at: string
          status: string
        }
        Insert: {
          attempt_no?: number
          bridge_id?: string | null
          delivery?: Database["public"]["Enums"]["print_delivery"] | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          print_job_id: string
          restaurant_id: string
          started_at?: string
          status: string
        }
        Update: {
          attempt_no?: number
          bridge_id?: string | null
          delivery?: Database["public"]["Enums"]["print_delivery"] | null
          error_code?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          print_job_id?: string
          restaurant_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_attempts_bridge_id_fkey"
            columns: ["bridge_id"]
            isOneToOne: false
            referencedRelation: "print_bridges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_attempts_print_job_id_fkey"
            columns: ["print_job_id"]
            isOneToOne: false
            referencedRelation: "print_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_attempts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      print_bridge_devices: {
        Row: {
          bridge_id: string
          created_at: string
          device_id: string | null
          driver_name: string | null
          id: string
          is_default: boolean
          is_virtual: boolean
          last_seen_at: string
          port_name: string | null
          restaurant_id: string
          windows_name: string
        }
        Insert: {
          bridge_id: string
          created_at?: string
          device_id?: string | null
          driver_name?: string | null
          id?: string
          is_default?: boolean
          is_virtual?: boolean
          last_seen_at?: string
          port_name?: string | null
          restaurant_id: string
          windows_name: string
        }
        Update: {
          bridge_id?: string
          created_at?: string
          device_id?: string | null
          driver_name?: string | null
          id?: string
          is_default?: boolean
          is_virtual?: boolean
          last_seen_at?: string
          port_name?: string | null
          restaurant_id?: string
          windows_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_bridge_devices_bridge_id_fkey"
            columns: ["bridge_id"]
            isOneToOne: false
            referencedRelation: "print_bridges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_bridge_devices_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      print_bridge_pair_codes: {
        Row: {
          code: string
          consumed_at: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          restaurant_id: string
        }
        Insert: {
          code: string
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          restaurant_id: string
        }
        Update: {
          code?: string
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_bridge_pair_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_bridge_pair_codes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      print_bridges: {
        Row: {
          created_at: string
          device_name: string | null
          display_name: string
          id: string
          is_active: boolean
          last_connected_at: string | null
          last_heartbeat_at: string | null
          last_restart_at: string | null
          pairing_token_hash: string | null
          restaurant_id: string
          token_hash: string | null
          token_prefix: string | null
          updated_at: string
          version: string | null
          windows_username: string | null
        }
        Insert: {
          created_at?: string
          device_name?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          last_connected_at?: string | null
          last_heartbeat_at?: string | null
          last_restart_at?: string | null
          pairing_token_hash?: string | null
          restaurant_id: string
          token_hash?: string | null
          token_prefix?: string | null
          updated_at?: string
          version?: string | null
          windows_username?: string | null
        }
        Update: {
          created_at?: string
          device_name?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          last_connected_at?: string | null
          last_heartbeat_at?: string | null
          last_restart_at?: string | null
          pairing_token_hash?: string | null
          restaurant_id?: string
          token_hash?: string | null
          token_prefix?: string | null
          updated_at?: string
          version?: string | null
          windows_username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "print_bridges_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      print_document_layouts: {
        Row: {
          document_type: string
          layout: Json
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          document_type: string
          layout: Json
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          document_type?: string
          layout?: Json
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_document_layouts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          attempt_count: number
          bridge_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          delivery: Database["public"]["Enums"]["print_delivery"] | null
          expires_at: string | null
          id: string
          is_reprint: boolean
          kind: Database["public"]["Enums"]["print_job_kind"]
          last_error: string | null
          max_attempts: number
          next_attempt_at: string | null
          order_id: string | null
          payload: Json
          printer_id: string | null
          reference: string
          reprint_of_job_id: string | null
          reprint_reason: string | null
          restaurant_id: string
          status: Database["public"]["Enums"]["print_job_status"]
          template_id: string | null
          template_version: number | null
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          bridge_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          delivery?: Database["public"]["Enums"]["print_delivery"] | null
          expires_at?: string | null
          id?: string
          is_reprint?: boolean
          kind: Database["public"]["Enums"]["print_job_kind"]
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          order_id?: string | null
          payload?: Json
          printer_id?: string | null
          reference: string
          reprint_of_job_id?: string | null
          reprint_reason?: string | null
          restaurant_id: string
          status?: Database["public"]["Enums"]["print_job_status"]
          template_id?: string | null
          template_version?: number | null
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          bridge_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          delivery?: Database["public"]["Enums"]["print_delivery"] | null
          expires_at?: string | null
          id?: string
          is_reprint?: boolean
          kind?: Database["public"]["Enums"]["print_job_kind"]
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string | null
          order_id?: string | null
          payload?: Json
          printer_id?: string | null
          reference?: string
          reprint_of_job_id?: string | null
          reprint_reason?: string | null
          restaurant_id?: string
          status?: Database["public"]["Enums"]["print_job_status"]
          template_id?: string | null
          template_version?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_jobs_bridge_id_fkey"
            columns: ["bridge_id"]
            isOneToOne: false
            referencedRelation: "print_bridges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "print_bridges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_reprint_of_job_id_fkey"
            columns: ["reprint_of_job_id"]
            isOneToOne: false
            referencedRelation: "print_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_jobs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "print_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      print_ops_settings: {
        Row: {
          is_test_environment: boolean
          restaurant_id: string
          testing_print_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          is_test_environment?: boolean
          restaurant_id: string
          testing_print_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          is_test_environment?: boolean
          restaurant_id?: string
          testing_print_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "print_ops_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      print_role_defaults: {
        Row: {
          printer_id: string | null
          restaurant_id: string
          role: Database["public"]["Enums"]["printer_role"]
          template_id: string | null
        }
        Insert: {
          printer_id?: string | null
          restaurant_id: string
          role: Database["public"]["Enums"]["printer_role"]
          template_id?: string | null
        }
        Update: {
          printer_id?: string | null
          restaurant_id?: string
          role?: Database["public"]["Enums"]["printer_role"]
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "print_role_defaults_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_role_defaults_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_role_defaults_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "print_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      print_settings: {
        Row: {
          auto_cut: boolean
          default_copies: number
          font_body_pt: number
          font_title_pt: number
          font_total_pt: number
          kitchen_show_prices: boolean
          open_cash_drawer: boolean
          paper_width_mm: number
          print_job_ttl_minutes: number
          receipt_slogan: string | null
          restaurant_address: string | null
          restaurant_id: string
          restaurant_phone: string | null
          show_qr_on_receipt: boolean
          thank_you_message: string | null
          updated_at: string
        }
        Insert: {
          auto_cut?: boolean
          default_copies?: number
          font_body_pt?: number
          font_title_pt?: number
          font_total_pt?: number
          kitchen_show_prices?: boolean
          open_cash_drawer?: boolean
          paper_width_mm?: number
          print_job_ttl_minutes?: number
          receipt_slogan?: string | null
          restaurant_address?: string | null
          restaurant_id: string
          restaurant_phone?: string | null
          show_qr_on_receipt?: boolean
          thank_you_message?: string | null
          updated_at?: string
        }
        Update: {
          auto_cut?: boolean
          default_copies?: number
          font_body_pt?: number
          font_title_pt?: number
          font_total_pt?: number
          kitchen_show_prices?: boolean
          open_cash_drawer?: boolean
          paper_width_mm?: number
          print_job_ttl_minutes?: number
          receipt_slogan?: string | null
          restaurant_address?: string | null
          restaurant_id?: string
          restaurant_phone?: string | null
          show_qr_on_receipt?: boolean
          thank_you_message?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      print_templates: {
        Row: {
          body: Json
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["print_job_kind"]
          name: string
          restaurant_id: string
          version: number
        }
        Insert: {
          body?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["print_job_kind"]
          name: string
          restaurant_id: string
          version?: number
        }
        Update: {
          body?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["print_job_kind"]
          name?: string
          restaurant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "print_templates_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      printers: {
        Row: {
          address: Json
          auto_cut: boolean
          bridge_id: string | null
          connection: Database["public"]["Enums"]["printer_connection"]
          created_at: string
          default_copies: number
          device_type: string
          encoding: string
          footer_text: string | null
          id: string
          is_active: boolean
          last_error: string | null
          last_success_at: string | null
          logo_url: string | null
          name: string
          open_cash_drawer: boolean
          paper_width_mm: number
          restaurant_id: string
          role: Database["public"]["Enums"]["printer_role"]
          sort_order: number
          updated_at: string
        }
        Insert: {
          address?: Json
          auto_cut?: boolean
          bridge_id?: string | null
          connection?: Database["public"]["Enums"]["printer_connection"]
          created_at?: string
          default_copies?: number
          device_type?: string
          encoding?: string
          footer_text?: string | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_success_at?: string | null
          logo_url?: string | null
          name: string
          open_cash_drawer?: boolean
          paper_width_mm?: number
          restaurant_id: string
          role: Database["public"]["Enums"]["printer_role"]
          sort_order?: number
          updated_at?: string
        }
        Update: {
          address?: Json
          auto_cut?: boolean
          bridge_id?: string | null
          connection?: Database["public"]["Enums"]["printer_connection"]
          created_at?: string
          default_copies?: number
          device_type?: string
          encoding?: string
          footer_text?: string | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_success_at?: string | null
          logo_url?: string | null
          name?: string
          open_cash_drawer?: boolean
          paper_width_mm?: number
          restaurant_id?: string
          role?: Database["public"]["Enums"]["printer_role"]
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "printers_bridge_id_fkey"
            columns: ["bridge_id"]
            isOneToOne: false
            referencedRelation: "print_bridges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "printers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_lines: {
        Row: {
          created_at: string
          id: string
          ingredient_id: string
          line_total: number
          notes: string | null
          purchase_id: string
          qty: number
          restaurant_id: string
          stock_movement_id: string | null
          unit_price: number
          uom_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_id: string
          line_total: number
          notes?: string | null
          purchase_id: string
          qty: number
          restaurant_id: string
          stock_movement_id?: string | null
          unit_price: number
          uom_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_id?: string
          line_total?: number
          notes?: string | null
          purchase_id?: string
          qty?: number
          restaurant_id?: string
          stock_movement_id?: string | null
          unit_price?: number
          uom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_lines_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_lines_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_lines_stock_movement_id_fkey"
            columns: ["stock_movement_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_lines_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency_code: string
          direct_label: string | null
          executed_at: string | null
          id: string
          notes: string | null
          payment_method: string
          reference: string
          restaurant_id: string
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          source_kind: string
          status: Database["public"]["Enums"]["fin_status"]
          supplier_id: string | null
          total_amount: number
          treasury_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          direct_label?: string | null
          executed_at?: string | null
          id?: string
          notes?: string | null
          payment_method?: string
          reference: string
          restaurant_id: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          source_kind: string
          status?: Database["public"]["Enums"]["fin_status"]
          supplier_id?: string | null
          total_amount: number
          treasury_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          currency_code?: string
          direct_label?: string | null
          executed_at?: string | null
          id?: string
          notes?: string | null
          payment_method?: string
          reference?: string
          restaurant_id?: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          source_kind?: string
          status?: Database["public"]["Enums"]["fin_status"]
          supplier_id?: string | null
          total_amount?: number
          treasury_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_treasury_id_fkey"
            columns: ["treasury_id"]
            isOneToOne: false
            referencedRelation: "treasuries"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_lines: {
        Row: {
          id: string
          ingredient_id: string
          qty: number
          recipe_id: string
          sort_order: number
          uom_id: string
        }
        Insert: {
          id?: string
          ingredient_id: string
          qty: number
          recipe_id: string
          sort_order?: number
          uom_id: string
        }
        Update: {
          id?: string
          ingredient_id?: string
          qty?: number
          recipe_id?: string
          sort_order?: number
          uom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_lines_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_lines_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_lines_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          menu_item_id: string | null
          name_ar: string
          name_en: string | null
          restaurant_id: string
          updated_at: string
          waste_pct: number
          yield_qty: number
          yield_uom_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          menu_item_id?: string | null
          name_ar: string
          name_en?: string | null
          restaurant_id: string
          updated_at?: string
          waste_pct?: number
          yield_qty: number
          yield_uom_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          menu_item_id?: string | null
          name_ar?: string
          name_en?: string | null
          restaurant_id?: string
          updated_at?: string
          waste_pct?: number
          yield_qty?: number
          yield_uom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_yield_uom_id_fkey"
            columns: ["yield_uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_notification_settings: {
        Row: {
          notify_on_order_edit: boolean
          providers: Json
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          notify_on_order_edit?: boolean
          providers?: Json
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          notify_on_order_edit?: boolean
          providers?: Json
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_notification_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          created_at: string
          currency_code: string
          id: string
          is_active: boolean
          name: string
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency_code?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency_code?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      shift_handovers: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["shift_handover_kind"]
          receive_variance: number | null
          received_actual_cash: number | null
          received_at: string | null
          received_by: string | null
          reference: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          restaurant_id: string
          review_notes: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          shift_id: string
          status: Database["public"]["Enums"]["shift_handover_status"]
          target_shift_id: string | null
          transfer_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["shift_handover_kind"]
          receive_variance?: number | null
          received_actual_cash?: number | null
          received_at?: string | null
          received_by?: string | null
          reference: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          restaurant_id: string
          review_notes?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id: string
          status?: Database["public"]["Enums"]["shift_handover_status"]
          target_shift_id?: string | null
          transfer_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["shift_handover_kind"]
          receive_variance?: number | null
          received_actual_cash?: number | null
          received_at?: string | null
          received_by?: string | null
          reference?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          restaurant_id?: string
          review_notes?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id?: string
          status?: Database["public"]["Enums"]["shift_handover_status"]
          target_shift_id?: string | null
          transfer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_handovers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_handovers_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_handovers_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_handovers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_handovers_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_handovers_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_handovers_target_shift_id_fkey"
            columns: ["target_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_handovers_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "treasury_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          actual_cash_count: number | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          difference_reason: string | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          reference: string
          restaurant_id: string
          status: string
        }
        Insert: {
          actual_cash_count?: number | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          difference_reason?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          reference: string
          restaurant_id: string
          status?: string
        }
        Update: {
          actual_cash_count?: number | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          difference_reason?: string | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          reference?: string
          restaurant_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          can_operational_purchase: boolean | null
          can_print_manage: boolean | null
          created_at: string
          discount_permissions: Json | null
          display_name: string
          email: string | null
          id: string
          is_active: boolean
          pin_hash: string | null
          restaurant_id: string
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          can_operational_purchase?: boolean | null
          can_print_manage?: boolean | null
          created_at?: string
          discount_permissions?: Json | null
          display_name: string
          email?: string | null
          id?: string
          is_active?: boolean
          pin_hash?: string | null
          restaurant_id: string
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          can_operational_purchase?: boolean | null
          can_print_manage?: boolean | null
          created_at?: string
          discount_permissions?: Json | null
          display_name?: string
          email?: string | null
          id?: string
          is_active?: boolean
          pin_hash?: string | null
          restaurant_id?: string
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_branches: {
        Row: {
          branch_id: string
          created_at: string
          role: Database["public"]["Enums"]["staff_role"]
          staff_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          role: Database["public"]["Enums"]["staff_role"]
          staff_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          role?: Database["public"]["Enums"]["staff_role"]
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_branches_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_invites: {
        Row: {
          accepted_at: string | null
          branch_assignments: Json
          created_at: string
          display_name: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          restaurant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          branch_assignments: Json
          created_at?: string
          display_name: string
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          restaurant_id: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          branch_assignments?: Json
          created_at?: string
          display_name?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          restaurant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_invites_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_sessions: {
        Row: {
          approved_at: string | null
          counted_at: string | null
          created_at: string
          id: string
          location_id: string
          restaurant_id: string
          status: string
        }
        Insert: {
          approved_at?: string | null
          counted_at?: string | null
          created_at?: string
          id?: string
          location_id: string
          restaurant_id: string
          status?: string
        }
        Update: {
          approved_at?: string | null
          counted_at?: string | null
          created_at?: string
          id?: string
          location_id?: string
          restaurant_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_sessions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_locations: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name_ar: string
          restaurant_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name_ar: string
          restaurant_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name_ar?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_locations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_lots: {
        Row: {
          created_at: string
          expiry_date: string | null
          id: string
          ingredient_id: string
          lot_code: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          expiry_date?: string | null
          id?: string
          ingredient_id: string
          lot_code: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          expiry_date?: string | null
          id?: string
          ingredient_id?: string
          lot_code?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_lots_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["stock_movement_direction"]
          id: string
          ingredient_id: string
          location_id: string
          lot_id: string | null
          moved_at: string
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          qty: number
          qty_base: number
          reason: string | null
          reference: string
          restaurant_id: string
          reverses_movement_id: string | null
          source_id: string | null
          source_type: string | null
          uom_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          direction: Database["public"]["Enums"]["stock_movement_direction"]
          id?: string
          ingredient_id: string
          location_id: string
          lot_id?: string | null
          moved_at?: string
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          qty: number
          qty_base: number
          reason?: string | null
          reference: string
          restaurant_id: string
          reverses_movement_id?: string | null
          source_id?: string | null
          source_type?: string | null
          uom_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["stock_movement_direction"]
          id?: string
          ingredient_id?: string
          location_id?: string
          lot_id?: string | null
          moved_at?: string
          movement_type?: Database["public"]["Enums"]["stock_movement_type"]
          qty?: number
          qty_base?: number
          reason?: string | null
          reference?: string
          restaurant_id?: string
          reverses_movement_id?: string | null
          source_id?: string | null
          source_type?: string | null
          uom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "stock_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_reverses_movement_id_fkey"
            columns: ["reverses_movement_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_obligations: {
        Row: {
          allocated_amount: number
          created_at: string
          id: string
          original_amount: number
          purchase_id: string
          restaurant_id: string
          status: string
          supplier_id: string
          voided_at: string | null
        }
        Insert: {
          allocated_amount?: number
          created_at?: string
          id?: string
          original_amount: number
          purchase_id: string
          restaurant_id: string
          status?: string
          supplier_id: string
          voided_at?: string | null
        }
        Update: {
          allocated_amount?: number
          created_at?: string
          id?: string
          original_amount?: number
          purchase_id?: string
          restaurant_id?: string
          status?: string
          supplier_id?: string
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_obligations_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: true
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_obligations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_obligations_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payment_allocations: {
        Row: {
          amount: number
          created_at: string
          id: string
          obligation_id: string
          payment_id: string
          restaurant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          obligation_id: string
          payment_id: string
          restaurant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          obligation_id?: string
          payment_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payment_allocations_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "supplier_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "supplier_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payment_allocations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          executed_at: string | null
          id: string
          notes: string | null
          reference: string
          restaurant_id: string
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          status: Database["public"]["Enums"]["fin_status"]
          supplier_id: string
          treasury_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          executed_at?: string | null
          id?: string
          notes?: string | null
          reference: string
          restaurant_id: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: Database["public"]["Enums"]["fin_status"]
          supplier_id: string
          treasury_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          executed_at?: string | null
          id?: string
          notes?: string | null
          reference?: string
          restaurant_id?: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: Database["public"]["Enums"]["fin_status"]
          supplier_id?: string
          treasury_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_treasury_id_fkey"
            columns: ["treasury_id"]
            isOneToOne: false
            referencedRelation: "treasuries"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name_ar: string
          name_en: string | null
          notes: string | null
          phone: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name_ar: string
          name_en?: string | null
          notes?: string | null
          phone?: string | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string | null
          notes?: string | null
          phone?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasuries: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_shift_drawer: boolean
          name: string
          restaurant_id: string
          sort_order: number
          type: Database["public"]["Enums"]["treasury_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_shift_drawer?: boolean
          name: string
          restaurant_id: string
          sort_order?: number
          type: Database["public"]["Enums"]["treasury_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_shift_drawer?: boolean
          name?: string
          restaurant_id?: string
          sort_order?: number
          type?: Database["public"]["Enums"]["treasury_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasuries_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_adjustments: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          auto_approved: boolean
          created_at: string
          created_by: string | null
          executed_at: string | null
          id: string
          kind: string
          reason: string | null
          reference: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          restaurant_id: string
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          reverses_id: string | null
          shift_id: string | null
          status: Database["public"]["Enums"]["fin_status"]
          treasury_id: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          created_at?: string
          created_by?: string | null
          executed_at?: string | null
          id?: string
          kind: string
          reason?: string | null
          reference: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          restaurant_id: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reverses_id?: string | null
          shift_id?: string | null
          status?: Database["public"]["Enums"]["fin_status"]
          treasury_id: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          created_at?: string
          created_by?: string | null
          executed_at?: string | null
          id?: string
          kind?: string
          reason?: string | null
          reference?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          restaurant_id?: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reverses_id?: string | null
          shift_id?: string | null
          status?: Database["public"]["Enums"]["fin_status"]
          treasury_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_adjustments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_adjustments_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_adjustments_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_adjustments_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_adjustments_reverses_id_fkey"
            columns: ["reverses_id"]
            isOneToOne: false
            referencedRelation: "treasury_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_adjustments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_adjustments_treasury_id_fkey"
            columns: ["treasury_id"]
            isOneToOne: false
            referencedRelation: "treasuries"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          reference: string | null
          restaurant_id: string
          reverses_movement_id: string | null
          shift_id: string | null
          source: Database["public"]["Enums"]["movement_source"]
          source_ref_id: string | null
          source_ref_type: string | null
          transfer_id: string | null
          treasury_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          reference?: string | null
          restaurant_id: string
          reverses_movement_id?: string | null
          shift_id?: string | null
          source: Database["public"]["Enums"]["movement_source"]
          source_ref_id?: string | null
          source_ref_type?: string | null
          transfer_id?: string | null
          treasury_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          reference?: string | null
          restaurant_id?: string
          reverses_movement_id?: string | null
          shift_id?: string | null
          source?: Database["public"]["Enums"]["movement_source"]
          source_ref_id?: string | null
          source_ref_type?: string | null
          transfer_id?: string | null
          treasury_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_movements_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_movements_reverses_movement_id_fkey"
            columns: ["reverses_movement_id"]
            isOneToOne: false
            referencedRelation: "treasury_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_movements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_movements_treasury_id_fkey"
            columns: ["treasury_id"]
            isOneToOne: false
            referencedRelation: "treasuries"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_transfers: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          auto_approved: boolean
          created_at: string
          created_by: string | null
          dest_treasury_id: string
          executed_at: string | null
          id: string
          is_cash_drop: boolean
          reason: string | null
          reference: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          restaurant_id: string
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          reverses_id: string | null
          shift_id: string | null
          source_treasury_id: string
          status: Database["public"]["Enums"]["fin_status"]
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          created_at?: string
          created_by?: string | null
          dest_treasury_id: string
          executed_at?: string | null
          id?: string
          is_cash_drop?: boolean
          reason?: string | null
          reference: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          restaurant_id: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reverses_id?: string | null
          shift_id?: string | null
          source_treasury_id: string
          status?: Database["public"]["Enums"]["fin_status"]
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          auto_approved?: boolean
          created_at?: string
          created_by?: string | null
          dest_treasury_id?: string
          executed_at?: string | null
          id?: string
          is_cash_drop?: boolean
          reason?: string | null
          reference?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          restaurant_id?: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reverses_id?: string | null
          shift_id?: string | null
          source_treasury_id?: string
          status?: Database["public"]["Enums"]["fin_status"]
        }
        Relationships: [
          {
            foreignKeyName: "treasury_transfers_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_transfers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_transfers_dest_treasury_id_fkey"
            columns: ["dest_treasury_id"]
            isOneToOne: false
            referencedRelation: "treasuries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_transfers_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_transfers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_transfers_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_transfers_reverses_id_fkey"
            columns: ["reverses_id"]
            isOneToOne: false
            referencedRelation: "treasury_transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_transfers_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treasury_transfers_source_treasury_id_fkey"
            columns: ["source_treasury_id"]
            isOneToOne: false
            referencedRelation: "treasuries"
            referencedColumns: ["id"]
          },
        ]
      }
      uom_conversions: {
        Row: {
          created_at: string
          factor: number
          from_uom_id: string
          id: string
          restaurant_id: string
          to_uom_id: string
        }
        Insert: {
          created_at?: string
          factor: number
          from_uom_id: string
          id?: string
          restaurant_id: string
          to_uom_id: string
        }
        Update: {
          created_at?: string
          factor?: number
          from_uom_id?: string
          id?: string
          restaurant_id?: string
          to_uom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "uom_conversions_from_uom_id_fkey"
            columns: ["from_uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uom_conversions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uom_conversions_to_uom_id_fkey"
            columns: ["to_uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      uoms: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name_ar: string
          name_en: string | null
          restaurant_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar: string
          name_en?: string | null
          restaurant_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string | null
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "uoms_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acknowledge_ops_message: { Args: { p_id: string }; Returns: undefined }
      add_ops_feedback_comment: {
        Args: { p_body: string; p_feedback_id: string }
        Returns: string
      }
      amend_order: {
        Args: { p_items?: Json; p_order_id: string; p_reason?: string }
        Returns: Json
      }
      append_order_items: {
        Args: { p_items: Json; p_order_id: string }
        Returns: Json
      }
      apply_order_discount: {
        Args: { p_discount?: Json; p_order_id: string }
        Returns: Json
      }
      approve_adjustment: { Args: { p_id: string }; Returns: undefined }
      approve_collection: { Args: { p_id: string }; Returns: undefined }
      approve_collections: { Args: { p_ids: string[] }; Returns: undefined }
      approve_expense: { Args: { p_id: string }; Returns: undefined }
      approve_pending_for_shift: { Args: { p_shift_id: string }; Returns: Json }
      approve_transfer: { Args: { p_id: string }; Returns: undefined }
      assert_cash_ops_allowed: { Args: never; Returns: undefined }
      assert_discount_payload_allowed: {
        Args: { p_discount: Json }
        Returns: undefined
      }
      assert_no_pending_handover: {
        Args: { p_rest: string }
        Returns: undefined
      }
      assert_order_accepts_collection: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      assign_delivery_driver: {
        Args: { p_driver_id?: string; p_order_id: string; p_reason?: string }
        Returns: undefined
      }
      auth_restaurant_id: { Args: never; Returns: string }
      auth_staff_id: { Args: never; Returns: string }
      bootstrap_owner_staff: {
        Args: {
          p_branch_id: string
          p_display_name: string
          p_restaurant_id: string
          p_user_id: string
          p_username: string
        }
        Returns: string
      }
      bridge_heartbeat: {
        Args: {
          p_device_name?: string
          p_restarted?: boolean
          p_token: string
          p_version?: string
          p_windows_username?: string
        }
        Returns: Json
      }
      cancel_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      cancel_print_job: {
        Args: { p_job_id: string; p_reason: string }
        Returns: undefined
      }
      cash_drop: {
        Args: { p_amount: number; p_reason: string }
        Returns: string
      }
      choose_cashier_windows_printer: {
        Args: { p_windows_name: string }
        Returns: Json
      }
      claim_print_jobs: {
        Args: { p_bridge_id?: string; p_limit?: number; p_token?: string }
        Returns: Json
      }
      clear_order_review: { Args: { p_order_id: string }; Returns: undefined }
      close_shift: {
        Args: {
          p_actual_cash_count: number
          p_destination: string
          p_difference_reason: string
          p_notes: string
        }
        Returns: Json
      }
      collect_remaining: {
        Args: { p_order_id: string; p_tenders: Json }
        Returns: Json
      }
      compute_menu_item_cost: {
        Args: { p_menu_item_id: string }
        Returns: Json
      }
      compute_recipe_cost: { Args: { p_recipe_id: string }; Returns: Json }
      create_adjustment: {
        Args: {
          p_amount: number
          p_kind: string
          p_reason: string
          p_treasury_id: string
        }
        Returns: string
      }
      create_delivery_order: {
        Args: {
          p_customer_id?: string
          p_customer_name?: string
          p_customer_phone?: string
          p_delivery_address?: string
          p_delivery_notes?: string
          p_delivery_zone?: string
          p_items: Json
          p_order_note?: string
        }
        Returns: Json
      }
      create_expense: {
        Args: {
          p_amount: number
          p_category: Database["public"]["Enums"]["expense_category"]
          p_description: string
          p_treasury_id: string
          p_vendor: string
        }
        Returns: string
      }
      create_print_bridge_pair_code: { Args: never; Returns: Json }
      create_transfer: {
        Args: {
          p_amount: number
          p_dest_treasury_id: string
          p_reason: string
          p_source_treasury_id: string
        }
        Returns: string
      }
      create_treasury: {
        Args: {
          p_name: string
          p_sort_order: number
          p_type: Database["public"]["Enums"]["treasury_type"]
        }
        Returns: string
      }
      create_unpaid_order: {
        Args: {
          p_customer_id?: string
          p_customer_name?: string
          p_customer_phone?: string
          p_delivery_address?: string
          p_delivery_driver_id?: string
          p_delivery_notes?: string
          p_delivery_zone?: string
          p_dine_in_table_ref?: string
          p_items: Json
          p_order_note?: string
          p_order_type?: Database["public"]["Enums"]["pos_order_type"]
        }
        Returns: Json
      }
      diagnose_bridge_claim: { Args: { p_token: string }; Returns: Json }
      diagnose_print_system: { Args: never; Returns: Json }
      drawer_treasury_id: { Args: { p_rest: string }; Returns: string }
      edit_pending_order: {
        Args: {
          p_customer_id?: string
          p_customer_name?: string
          p_customer_phone?: string
          p_items: Json
          p_order_id: string
          p_order_note?: string
          p_tenders?: Json
        }
        Returns: Json
      }
      enqueue_layout_preview_print: {
        Args: { p_document_type: string; p_layout: Json; p_snapshot: Json }
        Returns: string
      }
      enqueue_test_print: { Args: { p_printer_id: string }; Returns: string }
      ensure_main_cash_treasury_id: {
        Args: { p_rest: string }
        Returns: string
      }
      expire_stale_print_jobs: { Args: never; Returns: number }
      finalize_sale: {
        Args: {
          p_client_request_id?: string
          p_customer_id?: string
          p_customer_name?: string
          p_customer_phone?: string
          p_delivery_address?: string
          p_delivery_driver_id?: string
          p_delivery_notes?: string
          p_delivery_zone?: string
          p_dine_in_table_ref?: string
          p_discount?: Json
          p_items: Json
          p_order_note?: string
          p_order_type?: Database["public"]["Enums"]["pos_order_type"]
          p_tenders: Json
        }
        Returns: Json
      }
      financial_ref_exists: {
        Args: {
          p_ref_type: string
          p_reference: string
          p_restaurant_id: string
        }
        Returns: boolean
      }
      financial_ref_table_max: {
        Args: { p_prefix: string; p_ref_type: string; p_restaurant_id: string }
        Returns: number
      }
      get_customer_profile: {
        Args: { p_customer_id: string; p_orders_limit?: number }
        Returns: Json
      }
      get_day_collection_totals: { Args: { p_date?: string }; Returns: Json }
      get_my_staff_profile: { Args: never; Returns: Json }
      get_notification_settings: { Args: never; Returns: Json }
      get_open_shift: { Args: never; Returns: Json }
      get_order_detail: { Args: { p_order_id: string }; Returns: Json }
      get_order_print_summary: { Args: { p_order_id: string }; Returns: Json }
      get_order_timeline: { Args: { p_order_id: string }; Returns: Json }
      get_pos_context: { Args: never; Returns: Json }
      get_print_document_layout: {
        Args: { p_document_type: string }
        Returns: Json
      }
      get_print_ops_settings: { Args: never; Returns: Json }
      get_print_settings: { Args: never; Returns: Json }
      get_print_template: { Args: { p_id: string }; Returns: Json }
      get_printer_health: { Args: never; Returns: Json }
      get_recipe: { Args: { p_recipe_id: string }; Returns: Json }
      get_shift_archive: { Args: { p_shift_id: string }; Returns: Json }
      get_shift_collection_totals: {
        Args: { p_shift_id: string }
        Returns: Json
      }
      get_shift_report: { Args: { p_shift_id: string }; Returns: Json }
      get_smart_shift_sheet: { Args: { p_shift_id: string }; Returns: Json }
      get_treasury_balances: { Args: never; Returns: Json }
      get_treasury_ledger: {
        Args: { p_limit: number; p_treasury_id: string }
        Returns: Json
      }
      has_branch_access: { Args: { p_branch_id: string }; Returns: boolean }
      has_branch_role: {
        Args: {
          p_branch_id: string
          p_required_role: Database["public"]["Enums"]["staff_role"]
        }
        Returns: boolean
      }
      heal_residual_pending_for_shift: {
        Args: { p_shift_id: string }
        Returns: Json
      }
      inv_dashboard: { Args: never; Returns: Json }
      inv_default_direction: {
        Args: { p_type: Database["public"]["Enums"]["stock_movement_type"] }
        Returns: Database["public"]["Enums"]["stock_movement_direction"]
      }
      inv_ensure_default_location: {
        Args: { p_restaurant_id: string }
        Returns: string
      }
      inv_get_movement: { Args: { p_movement_id: string }; Returns: Json }
      inv_get_stock_card: {
        Args: {
          p_ingredient_id: string
          p_limit?: number
          p_location_id?: string
        }
        Returns: Json
      }
      inv_list_locations: { Args: never; Returns: Json }
      inv_list_stock_levels: { Args: never; Returns: Json }
      inv_next_reference: {
        Args: { p_prefix: string; p_restaurant_id: string }
        Returns: string
      }
      inv_on_hand: {
        Args: {
          p_ingredient_id: string
          p_location_id?: string
          p_restaurant_id: string
        }
        Returns: number
      }
      inv_post_movement: {
        Args: {
          p_direction?: Database["public"]["Enums"]["stock_movement_direction"]
          p_ingredient_id: string
          p_location_id?: string
          p_lot_id?: string
          p_movement_type: Database["public"]["Enums"]["stock_movement_type"]
          p_qty: number
          p_reason?: string
          p_reference?: string
          p_source_id?: string
          p_source_type?: string
          p_uom_id: string
        }
        Returns: Json
      }
      inv_post_receive_for_purchase: {
        Args: {
          p_ingredient_id: string
          p_qty: number
          p_reference: string
          p_restaurant_id: string
          p_source_id: string
          p_staff_id: string
          p_uom_id: string
        }
        Returns: Json
      }
      inv_require_manager: { Args: never; Returns: string }
      inv_reverse_for_purchase: {
        Args: {
          p_movement_id: string
          p_reason: string
          p_restaurant_id: string
          p_staff_id: string
        }
        Returns: Json
      }
      inv_reverse_movement: {
        Args: { p_movement_id: string; p_reason?: string }
        Returns: Json
      }
      inv_signed_qty_base: {
        Args: {
          p_direction: Database["public"]["Enums"]["stock_movement_direction"]
          p_qty_base: number
        }
        Returns: number
      }
      inv_upsert_stock_settings: {
        Args: { p_ingredient_id: string; p_reorder_level: number }
        Returns: Json
      }
      is_owner_or_manager: { Args: never; Returns: boolean }
      is_remote_operator: { Args: never; Returns: boolean }
      link_item_modifier_groups: {
        Args: { p_item_id: string; p_links: Json }
        Returns: undefined
      }
      liq_apply_revenue_split: {
        Args: {
          p_amount: number
          p_rest: string
          p_source_ref_id: string
          p_source_ref_type: string
          p_treasury_id: string
        }
        Returns: undefined
      }
      liq_ensure_settings: {
        Args: { p_rest: string }
        Returns: {
          operating_pct: number
          reserved_pct: number
          restaurant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "liquidity_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      liq_get_snapshot: { Args: never; Returns: Json }
      liq_is_main_cash: { Args: { p_treasury_id: string }; Returns: boolean }
      liq_list_allocations: { Args: { p_limit?: number }; Returns: Json }
      liq_operating_balance: { Args: { p_rest: string }; Returns: number }
      liq_release_reserved: {
        Args: { p_amount: number; p_reason: string }
        Returns: Json
      }
      liq_require_operating_funds: {
        Args: { p_amount: number; p_treasury_id: string }
        Returns: undefined
      }
      liq_reserved_balance: { Args: { p_rest: string }; Returns: number }
      liq_upsert_settings: {
        Args: { p_operating_pct: number; p_reserved_pct: number }
        Returns: Json
      }
      list_cost_impact: { Args: { p_ingredient_id: string }; Returns: Json }
      list_delivery_drivers: {
        Args: { p_active_only?: boolean }
        Returns: Json
      }
      list_frequent_customers: { Args: { p_limit?: number }; Returns: Json }
      list_ingredients: { Args: { p_active_only?: boolean }; Returns: Json }
      list_menu_admin: { Args: never; Returns: Json }
      list_menu_for_pos: { Args: never; Returns: Json }
      list_menu_items_recipe_status: { Args: never; Returns: Json }
      list_modifier_groups_admin: { Args: never; Returns: Json }
      list_ops_feedback_admin: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: Json
      }
      list_ops_feedback_comments: {
        Args: { p_feedback_id: string }
        Returns: Json
      }
      list_ops_messages: { Args: { p_limit?: number }; Returns: Json }
      list_orders_for_pos: {
        Args: {
          p_cashier_id?: string
          p_customer_id?: string
          p_date?: string
          p_fulfillment_status?: string
          p_hub_only?: boolean
          p_limit?: number
          p_offset?: number
          p_order_type?: string
          p_payment_status?: string
          p_pending_collections_only?: boolean
          p_search?: string
          p_shift_id?: string
        }
        Returns: Json
      }
      list_orders_requiring_review: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      list_pending_collections_for_shift: {
        Args: { p_limit?: number; p_offset?: number; p_shift_id: string }
        Returns: Json
      }
      list_pending_expenses_for_shift: {
        Args: { p_limit?: number; p_offset?: number; p_shift_id: string }
        Returns: Json
      }
      list_pending_handovers: { Args: never; Returns: Json }
      list_print_bridges: { Args: never; Returns: Json }
      list_print_jobs: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_order_id?: string
          p_status?: string
        }
        Returns: Json
      }
      list_print_templates: { Args: never; Returns: Json }
      list_printers: { Args: { p_active_only?: boolean }; Returns: Json }
      list_recipes: { Args: { p_active_only?: boolean }; Returns: Json }
      list_shifts_archive: { Args: { p_limit?: number }; Returns: Json }
      list_shifts_for_reports: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      list_staff: {
        Args: never
        Returns: {
          branches: Json
          can_operational_purchase: boolean
          can_print_manage: boolean
          created_at: string
          discount_permissions: Json
          display_name: string
          id: string
          is_active: boolean
          user_id: string
          username: string
        }[]
      }
      list_uom_conversions: { Args: never; Returns: Json }
      list_uoms: { Args: never; Returns: Json }
      log_audit_event: {
        Args: {
          p_action: string
          p_branch_id?: string
          p_correlation_id?: string
          p_entity_id?: string
          p_entity_type?: string
          p_new_data?: Json
          p_old_data?: Json
          p_restaurant_id: string
          p_staff_id?: string
        }
        Returns: string
      }
      log_auth_event: {
        Args: { p_action: string; p_metadata?: Json }
        Returns: string
      }
      lookup_customer_by_phone: { Args: { p_phone: string }; Returns: Json }
      m4_require_manager: { Args: never; Returns: string }
      m5_enqueue_kitchen_cancel_notice: {
        Args: { p_order_id: string; p_reason: string }
        Returns: string
      }
      m5_normalize_discount_permissions: { Args: { p: Json }; Returns: Json }
      m5_order_cancel_eligibility: {
        Args: { p_order_id: string }
        Returns: Json
      }
      m5_role_default_discount_permissions: { Args: never; Returns: Json }
      m5b_operational_treasury_balance: {
        Args: { p_shift_id: string; p_treasury_id: string }
        Returns: number
      }
      m5b_pending_collections_summary: {
        Args: { p_shift_id: string }
        Returns: Json
      }
      m5b_pending_expenses_summary: {
        Args: { p_shift_id: string }
        Returns: Json
      }
      m5b_post_collection_ledger: {
        Args: { p_actor: string; p_payment_id: string }
        Returns: undefined
      }
      m5b_recalc_order_payment_status: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      m5b_shift_approved_revenue: {
        Args: { p_shift_id: string }
        Returns: number
      }
      m5c_after_finalize_recalc: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      m5c_flag_order_review: {
        Args: {
          p_actor?: string
          p_financial_delta?: number
          p_order_id: string
          p_reason: string
        }
        Returns: undefined
      }
      m5c_order_collected_amount: {
        Args: { p_order_id: string }
        Returns: number
      }
      m5c_order_has_any_collection: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      m5c_order_has_approved_collection: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      m5c_order_money_snapshot: { Args: { p_order_id: string }; Returns: Json }
      m5c_record_collection_and_recalc: {
        Args: { p_order_id: string; p_tenders: Json }
        Returns: Json
      }
      m5c_timeline_label: {
        Args: { p_event_type: string; p_payload: Json }
        Returns: string
      }
      m6_auto_bind_printers_for_bridge: {
        Args: { p_bridge_id: string }
        Returns: Json
      }
      m6_backoff_seconds: { Args: { p_attempt: number }; Returns: number }
      m6_bake_document_field_labels: {
        Args: { p_document_type: string; p_layout: Json }
        Returns: Json
      }
      m6_bootstrap_test_print_environment: { Args: never; Returns: Json }
      m6_bridge_is_online: { Args: { p_bridge_id: string }; Returns: boolean }
      m6_build_handover_print_snapshot: {
        Args: { p_handover_id: string; p_phase?: string }
        Returns: Json
      }
      m6_build_order_print_payload: {
        Args: {
          p_kind: Database["public"]["Enums"]["print_job_kind"]
          p_order_id: string
        }
        Returns: Json
      }
      m6_compute_expires_at: {
        Args: { p_from?: string; p_rest: string }
        Returns: string
      }
      m6_default_document_layout: {
        Args: { p_document_type: string }
        Returns: Json
      }
      m6_default_printer_for_role: {
        Args: {
          p_rest: string
          p_role: Database["public"]["Enums"]["printer_role"]
        }
        Returns: string
      }
      m6_default_template_for_kind: {
        Args: {
          p_kind: Database["public"]["Enums"]["print_job_kind"]
          p_rest: string
        }
        Returns: string
      }
      m6_device_looks_thermal: {
        Args: {
          p_driver_name?: string
          p_port_name?: string
          p_windows_name: string
        }
        Returns: boolean
      }
      m6_enqueue_document_print: {
        Args: {
          p_is_reprint?: boolean
          p_kind: Database["public"]["Enums"]["print_job_kind"]
          p_order_id: string
          p_reason?: string
        }
        Returns: string
      }
      m6_enqueue_order_prints_on_create: {
        Args: { p_order_id: string; p_print_receipt?: boolean }
        Returns: undefined
      }
      m6_enqueue_receipt_on_collection: {
        Args: { p_order_id: string }
        Returns: string
      }
      m6_enqueue_shift_handover_print: {
        Args: { p_handover_id: string; p_phase?: string }
        Returns: string
      }
      m6_ensure_document_layout: {
        Args: { p_document_type: string; p_rest: string }
        Returns: Json
      }
      m6_ensure_layout_field: {
        Args: {
          p_default: Json
          p_field: string
          p_layout: Json
          p_section: string
        }
        Returns: Json
      }
      m6_ensure_print_ops_settings: {
        Args: { p_restaurant_id: string }
        Returns: {
          is_test_environment: boolean
          restaurant_id: string
          testing_print_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "print_ops_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      m6_expire_stale_print_jobs: { Args: { p_rest?: string }; Returns: number }
      m6_fmt_local_ts: { Args: { p_ts: string; p_tz: string }; Returns: string }
      m6_hash_token: { Args: { p_token: string }; Returns: string }
      m6_match_windows_printer: {
        Args: {
          p_bridge_id: string
          p_manual_name?: string
          p_prev_device_id?: string
          p_prev_driver?: string
          p_prev_port?: string
          p_wanted_name?: string
        }
        Returns: Json
      }
      m6_migrate_layout_fields_v3: {
        Args: { p_document_type: string; p_layout: Json }
        Returns: Json
      }
      m6_normalize_field_style: {
        Args: { p_def: Json; p_sec: Json }
        Returns: Json
      }
      m6_normalize_printer_name: { Args: { p_name: string }; Returns: string }
      m6_pick_bridge_windows_printer: {
        Args: { p_bridge_id: string }
        Returns: string
      }
      m6_printer_base_model: { Args: { p_name: string }; Returns: string }
      m6_printer_reason_ar: {
        Args: { p_from?: string; p_reason: string; p_to?: string }
        Returns: string
      }
      m6_refresh_order_print_status: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      m6_require_bridge_token: {
        Args: { p_token: string }
        Returns: {
          created_at: string
          device_name: string | null
          display_name: string
          id: string
          is_active: boolean
          last_connected_at: string | null
          last_heartbeat_at: string | null
          last_restart_at: string | null
          pairing_token_hash: string | null
          restaurant_id: string
          token_hash: string | null
          token_prefix: string | null
          updated_at: string
          version: string | null
          windows_username: string | null
        }
        SetofOptions: {
          from: "*"
          to: "print_bridges"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      m6_score_printer_candidate: {
        Args: {
          p_local_device_id: string
          p_local_driver: string
          p_local_is_default: boolean
          p_local_name: string
          p_local_port: string
          p_prev_device_id: string
          p_prev_driver: string
          p_prev_port: string
          p_wanted_name: string
        }
        Returns: number
      }
      m6_set_field_label_if_missing: {
        Args: {
          p_field: string
          p_label_ar: string
          p_label_en?: string
          p_layout: Json
          p_section: string
        }
        Returns: Json
      }
      m6_stamp_test_env_payload: {
        Args: { p_payload: Json; p_restaurant_id: string }
        Returns: Json
      }
      m6_transfer_restaurant_print_ownership: {
        Args: { p_bridge_id: string }
        Returns: Json
      }
      m6_ttl_minutes: { Args: { p_rest: string }; Returns: number }
      m8_assert_date_range: {
        Args: { p_from: string; p_to: string }
        Returns: undefined
      }
      m8_range_bounds: {
        Args: { p_from: string; p_to: string }
        Returns: {
          o_from: string
          o_to: string
        }[]
      }
      m8_require_reports_viewer: { Args: never; Returns: string }
      main_cash_treasury_id: { Args: { p_rest: string }; Returns: string }
      menu_require_manager: { Args: never; Returns: string }
      next_financial_ref: {
        Args: { p_prefix: string; p_ref_type: string; p_restaurant_id: string }
        Returns: string
      }
      next_shift_order_ref: {
        Args: { p_restaurant_id: string; p_shift_id: string }
        Returns: string
      }
      normalize_phone: { Args: { p_phone: string }; Returns: string }
      open_shift: {
        Args: {
          p_opening_float: number
          p_receive_handover_id?: string
          p_received_actual_cash?: number
        }
        Returns: string
      }
      pair_print_bridge: {
        Args: {
          p_code: string
          p_device_name?: string
          p_display_name?: string
          p_version?: string
          p_windows_username?: string
        }
        Returns: Json
      }
      pos_operational_transfer: {
        Args: {
          p_amount: number
          p_dest_treasury_id: string
          p_reason?: string
          p_source_treasury_id: string
        }
        Returns: string
      }
      pos_record_expense: {
        Args: {
          p_amount: number
          p_category?: Database["public"]["Enums"]["expense_category"]
          p_description?: string
          p_vendor?: string
        }
        Returns: string
      }
      pos_require_open_shift: { Args: { p_rest: string }; Returns: string }
      pos_search: { Args: { p_limit?: number; p_query: string }; Returns: Json }
      pos_staff_can_discount: { Args: never; Returns: boolean }
      pos_staff_discount_permissions: { Args: never; Returns: Json }
      preview_print_document: {
        Args: { p_document_type: string }
        Returns: Json
      }
      preview_print_template: {
        Args: { p_kind: Database["public"]["Enums"]["print_job_kind"] }
        Returns: Json
      }
      print_job_again: { Args: { p_job_id: string }; Returns: string }
      print_require_manage: { Args: never; Returns: string }
      print_staff_can_manage: { Args: never; Returns: boolean }
      provision_staff: {
        Args: {
          p_actor_user_id: string
          p_display_name: string
          p_email?: string
          p_is_active: boolean
          p_pin?: string
          p_role: Database["public"]["Enums"]["staff_role"]
          p_user_id: string
          p_username: string
        }
        Returns: string
      }
      pur_bootstrap_ops_uoms: { Args: never; Returns: Json }
      pur_create_ops_ingredient: {
        Args: {
          p_base_uom_id: string
          p_name_ar: string
          p_standard_cost?: number
        }
        Returns: Json
      }
      pur_get_purchase: { Args: { p_id: string }; Returns: Json }
      pur_get_supplier_balance: {
        Args: { p_supplier_id: string }
        Returns: Json
      }
      pur_get_supplier_statement: {
        Args: { p_limit?: number; p_supplier_id: string }
        Returns: Json
      }
      pur_list_ops_ingredients: { Args: never; Returns: Json }
      pur_list_ops_suppliers: { Args: never; Returns: Json }
      pur_list_ops_uoms: { Args: never; Returns: Json }
      pur_list_purchases: { Args: { p_limit?: number }; Returns: Json }
      pur_list_supplier_payments: {
        Args: { p_limit?: number; p_supplier_id?: string }
        Returns: Json
      }
      pur_list_suppliers: { Args: { p_active_only?: boolean }; Returns: Json }
      pur_post_credit_purchase: {
        Args: { p_lines: Json; p_notes: string; p_supplier_id: string }
        Returns: Json
      }
      pur_post_direct_cash_purchase: {
        Args: {
          p_direct_label: string
          p_lines: Json
          p_notes: string
          p_source_kind: string
          p_supplier_id: string
          p_treasury_id: string
        }
        Returns: Json
      }
      pur_post_supplier_payment: {
        Args: {
          p_amount: number
          p_notes?: string
          p_supplier_id: string
          p_treasury_id: string
        }
        Returns: Json
      }
      pur_require_credit_manager: { Args: never; Returns: string }
      pur_require_operational_purchase: { Args: never; Returns: string }
      pur_reverse_credit_purchase: {
        Args: { p_id: string; p_reason: string }
        Returns: Json
      }
      pur_reverse_direct_cash_purchase: {
        Args: { p_id: string; p_reason: string }
        Returns: Json
      }
      pur_reverse_supplier_payment: {
        Args: { p_id: string; p_reason: string }
        Returns: Json
      }
      pur_set_supplier_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      pur_staff_can_operational_purchase: { Args: never; Returns: boolean }
      pur_supplier_open_balance: {
        Args: { p_supplier_id: string }
        Returns: number
      }
      pur_upsert_supplier: {
        Args: {
          p_code?: string
          p_id: string
          p_is_active?: boolean
          p_name_ar: string
          p_name_en?: string
          p_notes?: string
          p_phone?: string
        }
        Returns: Json
      }
      rc_bootstrap_uoms: { Args: never; Returns: Json }
      rc_convert_qty: {
        Args: {
          p_from_uom: string
          p_qty: number
          p_restaurant_id: string
          p_to_uom: string
        }
        Returns: number
      }
      rc_ensure_default_uoms: {
        Args: { p_restaurant_id: string }
        Returns: undefined
      }
      rc_require_manager: { Args: never; Returns: string }
      receive_treasury_handover: { Args: { p_id: string }; Returns: Json }
      recipes_coverage_dashboard: { Args: never; Returns: Json }
      record_collection: {
        Args: { p_order_id: string; p_tenders: Json }
        Returns: Json
      }
      record_order_event: {
        Args: {
          p_actor_id?: string
          p_entity_id?: string
          p_entity_type?: string
          p_event_type: string
          p_order_id: string
          p_payload?: Json
        }
        Returns: string
      }
      record_password_change: {
        Args: { p_actor_user_id: string; p_staff_id: string }
        Returns: undefined
      }
      recreate_shift_handover: {
        Args: { p_destination: string; p_shift_id: string }
        Returns: Json
      }
      reject_adjustment: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reject_collection: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reject_collections: {
        Args: { p_ids: string[]; p_reason: string }
        Returns: undefined
      }
      reject_expense: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reject_pending_for_shift: {
        Args: { p_reason: string; p_shift_id: string }
        Returns: Json
      }
      reject_shift_handover: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reject_transfer: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reopen_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      report_bridge_printers: {
        Args: { p_printers?: Json; p_token: string }
        Returns: number
      }
      report_delivery_by_driver: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      report_expenses: { Args: { p_from: string; p_to: string }; Returns: Json }
      report_item_mix: {
        Args: { p_from: string; p_limit?: number; p_to: string }
        Returns: Json
      }
      report_official_sales: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      report_orders_summary: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      report_print_attempt: {
        Args: {
          p_bridge_id?: string
          p_delivery?: Database["public"]["Enums"]["print_delivery"]
          p_error_code?: string
          p_error_message?: string
          p_job_id: string
          p_success: boolean
          p_token?: string
        }
        Returns: undefined
      }
      report_print_reliability: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      report_today_summary: { Args: never; Returns: Json }
      report_treasury_ledger: {
        Args: {
          p_from: string
          p_limit?: number
          p_to: string
          p_treasury_id: string
        }
        Returns: Json
      }
      reprint_order: {
        Args: {
          p_kind?: Database["public"]["Enums"]["print_job_kind"]
          p_order_id: string
          p_reason?: string
        }
        Returns: string
      }
      resolve_staff_user_by_pin: { Args: { p_pin: string }; Returns: string }
      restaurant_has_pending_handover: {
        Args: { p_rest: string }
        Returns: boolean
      }
      retry_print_job: { Args: { p_job_id: string }; Returns: undefined }
      reverse_adjustment: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reverse_collection: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reverse_expense: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reverse_transfer: {
        Args: { p_id: string; p_reason: string }
        Returns: string
      }
      review_shift_handover: {
        Args: { p_decision: string; p_id: string; p_notes?: string }
        Returns: Json
      }
      search_customers: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      send_ops_message: {
        Args: {
          p_body: string
          p_print?: boolean
          p_target_role?: string
          p_target_station?: string
        }
        Returns: string
      }
      set_menu_category_status: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_menu_item_status: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_modifier_group_status: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_modifier_option_status: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_payment_method_mapping: {
        Args: { p_id: string; p_treasury_id: string }
        Returns: undefined
      }
      set_payment_method_status: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_printer_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_staff_pin: {
        Args: { p_pin: string; p_staff_id: string }
        Returns: undefined
      }
      set_staff_status: {
        Args: { p_active: boolean; p_reason?: string; p_staff_id: string }
        Returns: undefined
      }
      set_testing_print_enabled: { Args: { p_enabled: boolean }; Returns: Json }
      set_treasury_status: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      staff_role_rank: {
        Args: { p_role: Database["public"]["Enums"]["staff_role"] }
        Returns: number
      }
      submit_ops_feedback: {
        Args: {
          p_app_version?: string
          p_body: string
          p_bridge_version?: string
          p_context_id?: string
          p_context_type?: string
          p_device_label?: string
          p_image_path?: string
          p_kind: string
          p_priority?: string
          p_title: string
        }
        Returns: Json
      }
      sync_print_station_bindings: { Args: never; Returns: Json }
      touch_order_edited: { Args: { p_order_id: string }; Returns: undefined }
      treasury_balance: { Args: { p_treasury_id: string }; Returns: number }
      update_fulfillment_status: {
        Args: {
          p_order_id: string
          p_reason?: string
          p_status: Database["public"]["Enums"]["order_fulfillment_status"]
        }
        Returns: undefined
      }
      update_ops_feedback_status: {
        Args: {
          p_id: string
          p_resolution_note?: string
          p_resolved_in_version?: string
          p_status: string
        }
        Returns: undefined
      }
      update_staff: {
        Args: {
          p_branch_assignments: Json
          p_can_operational_purchase?: boolean
          p_can_print_manage?: boolean
          p_discount_permissions?: Json
          p_display_name: string
          p_set_operational_purchase?: boolean
          p_set_print_manage?: boolean
          p_staff_id: string
        }
        Returns: undefined
      }
      update_treasury: {
        Args: { p_id: string; p_name: string; p_sort_order: number }
        Returns: undefined
      }
      upsert_customer: {
        Args: {
          p_address?: string
          p_delivery_zone?: string
          p_display_name: string
          p_notes?: string
          p_phone: string
        }
        Returns: string
      }
      upsert_delivery_driver: {
        Args: {
          p_display_name?: string
          p_id?: string
          p_is_active?: boolean
          p_notes?: string
          p_phone?: string
        }
        Returns: string
      }
      upsert_ingredient: {
        Args: {
          p_base_uom_id: string
          p_code: string
          p_id: string
          p_is_active?: boolean
          p_name_ar: string
          p_name_en: string
          p_standard_cost: number
        }
        Returns: Json
      }
      upsert_menu_category: {
        Args: {
          p_id: string
          p_is_active: boolean
          p_name: string
          p_show_in_pos: boolean
          p_sort_order: number
        }
        Returns: string
      }
      upsert_menu_item: {
        Args: {
          p_accepts_modifiers: boolean
          p_allows_discounts: boolean
          p_base_price: number
          p_category_id: string
          p_description: string
          p_id: string
          p_is_favorite: boolean
          p_is_open_price: boolean
          p_name: string
          p_needs_kitchen: boolean
          p_needs_print: boolean
          p_show_in_pos: boolean
          p_sku: string
          p_sort_order: number
        }
        Returns: string
      }
      upsert_modifier_group: {
        Args: {
          p_id: string
          p_is_active: boolean
          p_max_selections: number
          p_min_selections: number
          p_name: string
          p_sort_order: number
        }
        Returns: string
      }
      upsert_modifier_option: {
        Args: {
          p_group_id: string
          p_id: string
          p_is_active: boolean
          p_is_default: boolean
          p_name: string
          p_price_delta: number
          p_sort_order: number
        }
        Returns: string
      }
      upsert_notification_settings: {
        Args: { p_notify_on_order_edit: boolean; p_providers?: Json }
        Returns: undefined
      }
      upsert_print_bridge_heartbeat: {
        Args: {
          p_device_name?: string
          p_display_name?: string
          p_id: string
          p_restarted?: boolean
          p_version?: string
          p_windows_username?: string
        }
        Returns: string
      }
      upsert_print_document_layout: {
        Args: { p_document_type: string; p_layout: Json }
        Returns: Json
      }
      upsert_print_settings: {
        Args: {
          p_auto_cut?: boolean
          p_default_copies?: number
          p_font_body_pt?: number
          p_font_title_pt?: number
          p_font_total_pt?: number
          p_kitchen_show_prices?: boolean
          p_open_cash_drawer?: boolean
          p_paper_width_mm?: number
          p_print_job_ttl_minutes?: number
          p_receipt_slogan?: string
          p_restaurant_address?: string
          p_restaurant_phone?: string
          p_show_qr_on_receipt?: boolean
          p_thank_you_message?: string
        }
        Returns: Json
      }
      upsert_printer: {
        Args: {
          p_address?: Json
          p_auto_cut?: boolean
          p_bridge_id?: string
          p_connection?: Database["public"]["Enums"]["printer_connection"]
          p_default_copies?: number
          p_device_type?: string
          p_encoding?: string
          p_footer_text?: string
          p_id: string
          p_is_active?: boolean
          p_logo_url?: string
          p_name: string
          p_open_cash_drawer?: boolean
          p_paper_width_mm?: number
          p_role: Database["public"]["Enums"]["printer_role"]
          p_sort_order?: number
          p_windows_printer_name?: string
        }
        Returns: string
      }
      upsert_recipe: {
        Args: {
          p_id: string
          p_is_active: boolean
          p_lines: Json
          p_menu_item_id: string
          p_name_ar: string
          p_name_en: string
          p_waste_pct: number
          p_yield_qty: number
          p_yield_uom_id: string
        }
        Returns: Json
      }
      upsert_uom_conversion: {
        Args: { p_factor: number; p_from_uom_id: string; p_to_uom_id: string }
        Returns: Json
      }
      verify_my_pin: { Args: { p_pin: string }; Returns: boolean }
      verify_staff_pin: {
        Args: { p_pin: string; p_staff_id: string }
        Returns: boolean
      }
    }
    Enums: {
      collection_status: "pending" | "approved" | "rejected" | "reversed"
      discount_type: "amount" | "percent"
      expense_category:
        | "petty_cash"
        | "supplies"
        | "utilities"
        | "salary"
        | "rent"
        | "maintenance"
        | "other"
      fin_status: "pending" | "approved" | "rejected" | "executed" | "reversed"
      ingredient_cost_mode: "standard" | "last_purchase" | "moving_average"
      kitchen_line_status:
        | "new"
        | "preparing"
        | "ready"
        | "served"
        | "cancelled"
      movement_source:
        | "opening_float"
        | "pos_payment"
        | "refund_reversal"
        | "expense"
        | "withdrawal"
        | "deposit"
        | "transfer_out"
        | "transfer_in"
        | "variance"
        | "purchase"
        | "supplier_payment"
      order_fulfillment_status:
        | "new"
        | "preparing"
        | "ready"
        | "delivered"
        | "cancelled"
      order_payment_status: "unpaid" | "partial" | "paid"
      order_print_status: "not_needed" | "pending" | "done" | "failed"
      order_status: "closed" | "voided" | "refunded"
      pos_order_type: "takeaway" | "delivery" | "dine_in"
      print_delivery: "transport_ack" | "device_confirmed"
      print_job_kind:
        | "receipt"
        | "kitchen"
        | "test_page"
        | "label"
        | "barcode"
        | "kitchen_sticker"
        | "delivery_label"
        | "shift_handover"
        | "ops_message"
      print_job_status:
        | "pending"
        | "completed"
        | "failed"
        | "claimed"
        | "printing"
        | "retry_wait"
        | "cancelled"
        | "expired"
      printer_connection:
        | "windows_spooler"
        | "lan_9100"
        | "usb"
        | "bluetooth"
        | "web_print"
        | "other"
      printer_role:
        | "cashier"
        | "kitchen"
        | "bar"
        | "dessert"
        | "label"
        | "receipt"
        | "other"
      shift_handover_kind: "to_main" | "to_next_shift"
      shift_handover_status: "pending" | "executed" | "rejected"
      staff_role:
        | "owner"
        | "manager"
        | "cashier"
        | "waiter"
        | "kitchen"
        | "remote_operator"
      stock_movement_direction: "in" | "out"
      stock_movement_type:
        | "opening"
        | "receive"
        | "purchase_receive"
        | "issue"
        | "production_in"
        | "production_out"
        | "recipe_consumption"
        | "waste"
        | "count_variance"
        | "adjustment"
        | "transfer_out"
        | "transfer_in"
        | "reverse"
      treasury_type: "cash" | "digital" | "bank"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      collection_status: ["pending", "approved", "rejected", "reversed"],
      discount_type: ["amount", "percent"],
      expense_category: [
        "petty_cash",
        "supplies",
        "utilities",
        "salary",
        "rent",
        "maintenance",
        "other",
      ],
      fin_status: ["pending", "approved", "rejected", "executed", "reversed"],
      ingredient_cost_mode: ["standard", "last_purchase", "moving_average"],
      kitchen_line_status: ["new", "preparing", "ready", "served", "cancelled"],
      movement_source: [
        "opening_float",
        "pos_payment",
        "refund_reversal",
        "expense",
        "withdrawal",
        "deposit",
        "transfer_out",
        "transfer_in",
        "variance",
        "purchase",
        "supplier_payment",
      ],
      order_fulfillment_status: [
        "new",
        "preparing",
        "ready",
        "delivered",
        "cancelled",
      ],
      order_payment_status: ["unpaid", "partial", "paid"],
      order_print_status: ["not_needed", "pending", "done", "failed"],
      order_status: ["closed", "voided", "refunded"],
      pos_order_type: ["takeaway", "delivery", "dine_in"],
      print_delivery: ["transport_ack", "device_confirmed"],
      print_job_kind: [
        "receipt",
        "kitchen",
        "test_page",
        "label",
        "barcode",
        "kitchen_sticker",
        "delivery_label",
        "shift_handover",
        "ops_message",
      ],
      print_job_status: [
        "pending",
        "completed",
        "failed",
        "claimed",
        "printing",
        "retry_wait",
        "cancelled",
        "expired",
      ],
      printer_connection: [
        "windows_spooler",
        "lan_9100",
        "usb",
        "bluetooth",
        "web_print",
        "other",
      ],
      printer_role: [
        "cashier",
        "kitchen",
        "bar",
        "dessert",
        "label",
        "receipt",
        "other",
      ],
      shift_handover_kind: ["to_main", "to_next_shift"],
      shift_handover_status: ["pending", "executed", "rejected"],
      staff_role: [
        "owner",
        "manager",
        "cashier",
        "waiter",
        "kitchen",
        "remote_operator",
      ],
      stock_movement_direction: ["in", "out"],
      stock_movement_type: [
        "opening",
        "receive",
        "purchase_receive",
        "issue",
        "production_in",
        "production_out",
        "recipe_consumption",
        "waste",
        "count_variance",
        "adjustment",
        "transfer_out",
        "transfer_in",
        "reverse",
      ],
      treasury_type: ["cash", "digital", "bank"],
    },
  },
} as const
