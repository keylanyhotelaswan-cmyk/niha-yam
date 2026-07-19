export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      restaurants: {
        Row: {
          id: string
          name: string
          slug: string
          currency_code: string
          timezone: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['restaurants']['Row']>
        Update: Partial<Database['public']['Tables']['restaurants']['Row']>
        Relationships: []
      }
      branches: {
        Row: {
          id: string
          restaurant_id: string
          name: string
          code: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['branches']['Row']>
        Update: Partial<Database['public']['Tables']['branches']['Row']>
        Relationships: []
      }
      staff: {
        Row: {
          id: string
          user_id: string
          restaurant_id: string
          username: string | null
          email: string | null
          display_name: string
          pin_hash: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['staff']['Row']>
        Update: Partial<Database['public']['Tables']['staff']['Row']>
        Relationships: []
      }
      menu_categories: {
        Row: {
          id: string
          restaurant_id: string
          name: string
          sort_order: number
          show_in_pos: boolean
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['menu_categories']['Row']>
        Update: Partial<Database['public']['Tables']['menu_categories']['Row']>
        Relationships: []
      }
      menu_items: {
        Row: {
          id: string
          restaurant_id: string
          category_id: string | null
          name: string
          sku: string | null
          base_price: number
          sort_order: number
          show_in_pos: boolean
          needs_kitchen: boolean
          needs_print: boolean
          accepts_modifiers: boolean
          allows_discounts: boolean
          is_open_price: boolean
          is_favorite: boolean
          is_active: boolean
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['menu_items']['Row']>
        Update: Partial<Database['public']['Tables']['menu_items']['Row']>
        Relationships: []
      }
      modifier_groups: {
        Row: {
          id: string
          restaurant_id: string
          name: string
          min_selections: number
          max_selections: number
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['modifier_groups']['Row']>
        Update: Partial<Database['public']['Tables']['modifier_groups']['Row']>
        Relationships: []
      }
      modifier_options: {
        Row: {
          id: string
          group_id: string
          name: string
          price_delta: number
          sort_order: number
          is_default: boolean
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['modifier_options']['Row']>
        Update: Partial<Database['public']['Tables']['modifier_options']['Row']>
        Relationships: []
      }
      menu_item_modifier_groups: {
        Row: {
          menu_item_id: string
          modifier_group_id: string
          sort_order: number
        }
        Insert: Partial<
          Database['public']['Tables']['menu_item_modifier_groups']['Row']
        >
        Update: Partial<
          Database['public']['Tables']['menu_item_modifier_groups']['Row']
        >
        Relationships: []
      }
      treasuries: {
        Row: {
          id: string
          restaurant_id: string
          name: string
          type: Database['public']['Enums']['treasury_type']
          is_shift_drawer: boolean
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['treasuries']['Row']>
        Update: Partial<Database['public']['Tables']['treasuries']['Row']>
        Relationships: []
      }
      payment_methods: {
        Row: {
          id: string
          restaurant_id: string
          name: string
          code: string
          treasury_id: string | null
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['payment_methods']['Row']>
        Update: Partial<Database['public']['Tables']['payment_methods']['Row']>
        Relationships: []
      }
      shifts: {
        Row: {
          id: string
          restaurant_id: string
          reference: string
          opened_by: string | null
          opened_at: string
          closed_by: string | null
          closed_at: string | null
          status: string
          actual_cash_count: number | null
          difference_reason: string | null
          notes: string | null
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['shifts']['Row']>
        Update: Partial<Database['public']['Tables']['shifts']['Row']>
        Relationships: []
      }
      treasury_movements: {
        Row: {
          id: string
          restaurant_id: string
          treasury_id: string
          shift_id: string | null
          amount: number
          source: Database['public']['Enums']['movement_source']
          source_ref_type: string | null
          source_ref_id: string | null
          reference: string | null
          transfer_id: string | null
          reverses_movement_id: string | null
          created_by: string | null
          created_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['treasury_movements']['Row']
        >
        Update: Partial<
          Database['public']['Tables']['treasury_movements']['Row']
        >
        Relationships: []
      }
      treasury_transfers: {
        Row: {
          id: string
          restaurant_id: string
          reference: string
          shift_id: string | null
          source_treasury_id: string
          dest_treasury_id: string
          amount: number
          reason: string | null
          is_cash_drop: boolean
          status: Database['public']['Enums']['fin_status']
          created_by: string | null
          approved_by: string | null
          rejected_by: string | null
          reversed_by: string | null
          approved_at: string | null
          rejected_at: string | null
          executed_at: string | null
          reversed_at: string | null
          rejection_reason: string | null
          reversal_reason: string | null
          reverses_id: string | null
          auto_approved: boolean
          created_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['treasury_transfers']['Row']
        >
        Update: Partial<
          Database['public']['Tables']['treasury_transfers']['Row']
        >
        Relationships: []
      }
      treasury_adjustments: {
        Row: {
          id: string
          restaurant_id: string
          reference: string
          shift_id: string | null
          treasury_id: string
          kind: string
          amount: number
          reason: string | null
          status: Database['public']['Enums']['fin_status']
          created_by: string | null
          approved_by: string | null
          rejected_by: string | null
          reversed_by: string | null
          approved_at: string | null
          rejected_at: string | null
          executed_at: string | null
          reversed_at: string | null
          rejection_reason: string | null
          reversal_reason: string | null
          reverses_id: string | null
          auto_approved: boolean
          created_at: string
        }
        Insert: Partial<
          Database['public']['Tables']['treasury_adjustments']['Row']
        >
        Update: Partial<
          Database['public']['Tables']['treasury_adjustments']['Row']
        >
        Relationships: []
      }
      expenses: {
        Row: {
          id: string
          restaurant_id: string
          reference: string
          shift_id: string | null
          treasury_id: string
          category: Database['public']['Enums']['expense_category']
          amount: number
          description: string | null
          vendor: string | null
          status: Database['public']['Enums']['fin_status']
          created_by: string | null
          approved_by: string | null
          rejected_by: string | null
          reversed_by: string | null
          approved_at: string | null
          rejected_at: string | null
          executed_at: string | null
          reversed_at: string | null
          rejection_reason: string | null
          reversal_reason: string | null
          reverses_id: string | null
          auto_approved: boolean
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['expenses']['Row']>
        Update: Partial<Database['public']['Tables']['expenses']['Row']>
        Relationships: []
      }
      financial_ref_counters: {
        Row: {
          restaurant_id: string
          ref_type: string
          current_value: number
        }
        Insert: Partial<
          Database['public']['Tables']['financial_ref_counters']['Row']
        >
        Update: Partial<
          Database['public']['Tables']['financial_ref_counters']['Row']
        >
        Relationships: []
      }
      orders: {
        Row: {
          id: string
          restaurant_id: string
          reference: string
          shift_id: string
          status: Database['public']['Enums']['order_status']
          order_type: string
          subtotal: number
          discount_amount: number
          total: number
          discount_type: Database['public']['Enums']['discount_type'] | null
          discount_value: number | null
          discount_reason: string | null
          order_note: string | null
          client_request_id: string | null
          created_by: string | null
          closed_at: string
          created_at: string
        }
        Insert: Partial<Database['public']['Tables']['orders']['Row']>
        Update: Partial<Database['public']['Tables']['orders']['Row']>
        Relationships: []
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          menu_item_id: string | null
          name: string
          sku: string | null
          unit_price: number
          quantity: number
          line_total: number
          is_open_price: boolean
          needs_kitchen: boolean
          needs_print: boolean
          line_note: string | null
          sort_order: number
        }
        Insert: Partial<Database['public']['Tables']['order_items']['Row']>
        Update: Partial<Database['public']['Tables']['order_items']['Row']>
        Relationships: []
      }
      order_payments: {
        Row: {
          id: string
          order_id: string
          reference: string
          payment_method_id: string
          treasury_id: string
          amount: number
          change_given: number
          created_at: string
          shift_id: string | null
          collection_status: Database['public']['Enums']['collection_status']
          net_amount: number | null
          created_by: string | null
          approved_by: string | null
          rejected_by: string | null
          reversed_by: string | null
          approved_at: string | null
          rejected_at: string | null
          reversed_at: string | null
          rejection_reason: string | null
          reversal_reason: string | null
          reverses_id: string | null
          auto_approved: boolean
        }
        Insert: Partial<Database['public']['Tables']['order_payments']['Row']>
        Update: Partial<Database['public']['Tables']['order_payments']['Row']>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      get_my_staff_profile: { Args: Record<string, never>; Returns: Json }
      list_staff: { Args: Record<string, never>; Returns: Json }
      update_staff: {
        Args: {
          p_staff_id: string
          p_display_name: string
          p_branch_assignments: Json
        }
        Returns: undefined
      }
      set_staff_status: {
        Args: { p_staff_id: string; p_active: boolean; p_reason?: string }
        Returns: undefined
      }
      set_staff_pin: {
        Args: { p_staff_id: string; p_pin: string }
        Returns: undefined
      }
      verify_staff_pin: {
        Args: { p_staff_id: string; p_pin: string }
        Returns: boolean
      }
      provision_staff: {
        Args: {
          p_actor_user_id: string
          p_user_id: string
          p_username: string
          p_display_name: string
          p_role: Database['public']['Enums']['staff_role']
          p_is_active: boolean
          p_pin?: string | null
          p_email?: string | null
        }
        Returns: string
      }
      record_password_change: {
        Args: { p_actor_user_id: string; p_staff_id: string }
        Returns: undefined
      }
      log_auth_event: {
        Args: { p_action: string; p_metadata?: Json }
        Returns: string
      }
      bootstrap_owner_staff: {
        Args: {
          p_user_id: string
          p_username: string
          p_display_name: string
          p_restaurant_id: string
          p_branch_id: string
        }
        Returns: string
      }
      upsert_menu_category: {
        Args: {
          p_id: string | null
          p_name: string
          p_sort_order: number
          p_show_in_pos: boolean
          p_is_active: boolean
        }
        Returns: string
      }
      set_menu_category_status: {
        Args: { p_id: string; p_active: boolean }
        Returns: undefined
      }
      upsert_menu_item: {
        Args: {
          p_id: string | null
          p_category_id: string | null
          p_name: string
          p_sku: string | null
          p_base_price: number
          p_sort_order: number
          p_show_in_pos: boolean
          p_needs_kitchen: boolean
          p_needs_print: boolean
          p_accepts_modifiers: boolean
          p_allows_discounts: boolean
          p_is_open_price: boolean
          p_is_favorite: boolean
          p_description: string | null
        }
        Returns: string
      }
      set_menu_item_status: {
        Args: { p_id: string; p_active: boolean }
        Returns: undefined
      }
      upsert_modifier_group: {
        Args: {
          p_id: string | null
          p_name: string
          p_min_selections: number
          p_max_selections: number
          p_sort_order: number
          p_is_active: boolean
        }
        Returns: string
      }
      set_modifier_group_status: {
        Args: { p_id: string; p_active: boolean }
        Returns: undefined
      }
      upsert_modifier_option: {
        Args: {
          p_id: string | null
          p_group_id: string
          p_name: string
          p_price_delta: number
          p_sort_order: number
          p_is_default: boolean
          p_is_active: boolean
        }
        Returns: string
      }
      set_modifier_option_status: {
        Args: { p_id: string; p_active: boolean }
        Returns: undefined
      }
      link_item_modifier_groups: {
        Args: { p_item_id: string; p_links: Json }
        Returns: undefined
      }
      list_menu_admin: { Args: Record<string, never>; Returns: Json }
      list_modifier_groups_admin: {
        Args: Record<string, never>
        Returns: Json
      }
      list_menu_for_pos: { Args: Record<string, never>; Returns: Json }
      get_pos_context: { Args: Record<string, never>; Returns: Json }
      finalize_sale: {
        Args: {
          p_items: Json
          p_tenders: Json
          p_discount?: Json | null
          p_order_note?: string | null
          p_client_request_id?: string | null
          p_order_type?: Database['public']['Enums']['pos_order_type']
          p_customer_id?: string | null
          p_customer_phone?: string | null
          p_customer_name?: string | null
          p_delivery_address?: string | null
          p_delivery_zone?: string | null
          p_delivery_notes?: string | null
          p_dine_in_table_ref?: string | null
          p_delivery_driver_id?: string | null
        }
        Returns: Json
      }
      pos_operational_transfer: {
        Args: {
          p_source_treasury_id: string
          p_dest_treasury_id: string
          p_amount: number
          p_reason?: string | null
        }
        Returns: string
      }
      pos_record_expense: {
        Args: {
          p_amount: number
          p_category?: Database['public']['Enums']['expense_category']
          p_description?: string | null
          p_vendor?: string | null
        }
        Returns: string
      }
      resolve_staff_user_by_pin: {
        Args: { p_pin: string }
        Returns: string
      }
      create_treasury: {
        Args: {
          p_name: string
          p_type: Database['public']['Enums']['treasury_type']
          p_sort_order: number
        }
        Returns: string
      }
      update_treasury: {
        Args: { p_id: string; p_name: string; p_sort_order: number }
        Returns: undefined
      }
      set_treasury_status: {
        Args: { p_id: string; p_active: boolean }
        Returns: undefined
      }
      set_payment_method_mapping: {
        Args: { p_id: string; p_treasury_id: string | null }
        Returns: undefined
      }
      set_payment_method_status: {
        Args: { p_id: string; p_active: boolean }
        Returns: undefined
      }
      open_shift: { Args: { p_opening_float: number }; Returns: string }
      close_shift: {
        Args: {
          p_actual_cash_count: number
          p_difference_reason: string | null
          p_notes: string | null
        }
        Returns: undefined
      }
      cash_drop: {
        Args: { p_amount: number; p_reason: string | null }
        Returns: string
      }
      create_transfer: {
        Args: {
          p_source_treasury_id: string
          p_dest_treasury_id: string
          p_amount: number
          p_reason: string | null
        }
        Returns: string
      }
      approve_transfer: { Args: { p_id: string }; Returns: undefined }
      reject_transfer: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reverse_transfer: {
        Args: { p_id: string; p_reason: string }
        Returns: string
      }
      create_expense: {
        Args: {
          p_treasury_id: string
          p_category: Database['public']['Enums']['expense_category']
          p_amount: number
          p_description: string | null
          p_vendor: string | null
        }
        Returns: string
      }
      approve_expense: { Args: { p_id: string }; Returns: undefined }
      reject_expense: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reverse_expense: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      create_adjustment: {
        Args: {
          p_treasury_id: string
          p_kind: string
          p_amount: number
          p_reason: string | null
        }
        Returns: string
      }
      approve_adjustment: { Args: { p_id: string }; Returns: undefined }
      reject_adjustment: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reverse_adjustment: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      get_treasury_balances: { Args: Record<string, never>; Returns: Json }
      get_treasury_ledger: {
        Args: { p_treasury_id: string; p_limit: number }
        Returns: Json
      }
      get_open_shift: { Args: Record<string, never>; Returns: Json }
      get_shift_report: { Args: { p_shift_id: string }; Returns: Json }
      list_orders_for_pos: {
        Args: {
          p_date?: string
          p_payment_status?: string | null
          p_fulfillment_status?: string | null
          p_order_type?: string | null
          p_cashier_id?: string | null
          p_customer_id?: string | null
          p_search?: string | null
          p_pending_collections_only?: boolean
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      get_order_detail: { Args: { p_order_id: string }; Returns: Json }
      get_order_timeline: { Args: { p_order_id: string }; Returns: Json }
      approve_collection: { Args: { p_id: string }; Returns: undefined }
      approve_collections: { Args: { p_ids: string[] }; Returns: undefined }
      approve_pending_for_shift: { Args: { p_shift_id: string }; Returns: Json }
      reject_collection: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      reject_collections: {
        Args: { p_ids: string[]; p_reason: string }
        Returns: undefined
      }
      reverse_collection: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      list_pending_collections_for_shift: {
        Args: { p_shift_id: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      lookup_customer_by_phone: { Args: { p_phone: string }; Returns: Json }
      upsert_customer: {
        Args: {
          p_display_name: string
          p_phone: string
          p_notes?: string | null
          p_address?: string | null
          p_delivery_zone?: string | null
        }
        Returns: string
      }
      create_delivery_order: {
        Args: {
          p_items: Json
          p_customer_id?: string | null
          p_customer_phone?: string | null
          p_customer_name?: string | null
          p_delivery_address?: string | null
          p_delivery_zone?: string | null
          p_delivery_notes?: string | null
          p_order_note?: string | null
        }
        Returns: Json
      }
      update_fulfillment_status: {
        Args: {
          p_order_id: string
          p_status: Database['public']['Enums']['order_fulfillment_status']
        }
        Returns: undefined
      }
      record_collection: {
        Args: { p_order_id: string; p_tenders: Json }
        Returns: Json
      }
      reprint_order: {
        Args: {
          p_order_id: string
          p_kind?: Database['public']['Enums']['print_job_kind']
        }
        Returns: string
      }
      create_unpaid_order: {
        Args: {
          p_items: Json
          p_order_type?: Database['public']['Enums']['pos_order_type']
          p_customer_id?: string | null
          p_customer_phone?: string | null
          p_customer_name?: string | null
          p_delivery_address?: string | null
          p_delivery_zone?: string | null
          p_delivery_notes?: string | null
          p_order_note?: string | null
          p_dine_in_table_ref?: string | null
          p_delivery_driver_id?: string | null
        }
        Returns: Json
      }
      search_customers: {
        Args: { p_query: string; p_limit?: number }
        Returns: Json
      }
      get_customer_profile: {
        Args: { p_customer_id: string; p_orders_limit?: number }
        Returns: Json
      }
      list_frequent_customers: {
        Args: { p_limit?: number }
        Returns: Json
      }
      list_delivery_drivers: {
        Args: { p_active_only?: boolean }
        Returns: Json
      }
      upsert_delivery_driver: {
        Args: {
          p_id?: string | null
          p_display_name?: string | null
          p_phone?: string | null
          p_is_active?: boolean
          p_notes?: string | null
        }
        Returns: string
      }
      assign_delivery_driver: {
        Args: {
          p_order_id: string
          p_driver_id?: string | null
          p_reason?: string | null
        }
        Returns: undefined
      }
      pos_search: {
        Args: { p_query: string; p_limit?: number }
        Returns: Json
      }
      collect_remaining: {
        Args: { p_order_id: string; p_tenders: Json }
        Returns: Json
      }
      edit_pending_order: {
        Args: {
          p_order_id: string
          p_items: Json
          p_customer_id?: string | null
          p_customer_phone?: string | null
          p_customer_name?: string | null
          p_tenders?: Json | null
          p_order_note?: string | null
        }
        Returns: Json
      }
      clear_order_review: {
        Args: { p_order_id: string }
        Returns: undefined
      }
    }
    Enums: {
      staff_role: 'owner' | 'manager' | 'cashier' | 'remote_operator' | 'waiter' | 'kitchen'
      treasury_type: 'cash' | 'digital' | 'bank'
      fin_status: 'pending' | 'approved' | 'rejected' | 'executed' | 'reversed'
      movement_source:
        | 'opening_float'
        | 'pos_payment'
        | 'refund_reversal'
        | 'expense'
        | 'withdrawal'
        | 'deposit'
        | 'transfer_out'
        | 'transfer_in'
        | 'variance'
      expense_category:
        | 'petty_cash'
        | 'supplies'
        | 'utilities'
        | 'salary'
        | 'rent'
        | 'maintenance'
        | 'other'
      order_status: 'closed' | 'voided' | 'refunded'
      discount_type: 'amount' | 'percent'
      kitchen_line_status:
        | 'new'
        | 'preparing'
        | 'ready'
        | 'served'
        | 'cancelled'
      print_job_kind: 'receipt' | 'kitchen'
      print_job_status: 'pending' | 'completed' | 'failed'
      pos_order_type: 'takeaway' | 'delivery' | 'dine_in'
      order_payment_status: 'unpaid' | 'partial' | 'paid'
      order_fulfillment_status:
        | 'new'
        | 'preparing'
        | 'ready'
        | 'delivered'
        | 'cancelled'
      order_print_status: 'not_needed' | 'pending' | 'done' | 'failed'
      collection_status: 'pending' | 'approved' | 'rejected' | 'reversed'
    }
    CompositeTypes: Record<string, never>
  }
}
