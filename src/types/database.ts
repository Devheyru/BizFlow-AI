
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "inventory": {
                  Row: {
                    "created_at": string,"id": string,"organization_id": string,"product_id": string,"quantity": number,"reorder_point": number | null,"reorder_quantity": number | null,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"organization_id": string,"product_id": string,"quantity"?: number,"reorder_point"?: number | null,"reorder_quantity"?: number | null,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"organization_id"?: string,"product_id"?: string,"quantity"?: number,"reorder_point"?: number | null,"reorder_quantity"?: number | null,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_audit_events": {
                  Row: {
                    "actor_id": string,"created_at": string,"event_type": string,"id": string,"metadata": NonNullable<Json>,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"created_at"?: string,"event_type": string,"id"?: string,"metadata"?: NonNullable<Json>,"organization_id": string
                  }
                  Update: {
                    "actor_id"?: string,"created_at"?: string,"event_type"?: string,"id"?: string,"metadata"?: NonNullable<Json>,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_audit_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_audit_events_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_invitations": {
                  Row: {
                    "created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string,"organization_id": string,"role": Database["public"]['Enums']["app_role"],"status": Database["public"]['Enums']["invitation_status"],"token_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"expires_at": string,"id"?: string,"invited_by": string,"organization_id": string,"role": Database["public"]['Enums']["app_role"],"status"?: Database["public"]['Enums']["invitation_status"],"token_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string,"organization_id"?: string,"role"?: Database["public"]['Enums']["app_role"],"status"?: Database["public"]['Enums']["invitation_status"],"token_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_invitations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_memberships": {
                  Row: {
                    "created_at": string,"id": string,"organization_id": string,"role": Database["public"]['Enums']["app_role"],"status": Database["public"]['Enums']["membership_status"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"organization_id": string,"role"?: Database["public"]['Enums']["app_role"],"status"?: Database["public"]['Enums']["membership_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"organization_id"?: string,"role"?: Database["public"]['Enums']["app_role"],"status"?: Database["public"]['Enums']["membership_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_memberships_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_memberships_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "address": string | null,"business_type": string,"client_mutation_id": string | null,"closed_at": string | null,"closed_by": string | null,"country": string,"created_at": string,"created_by": string,"currency": string,"email": string | null,"id": string,"is_active": boolean,"name": string,"phone": string | null,"slug": string,"tax_id": string | null,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"business_type": string,"client_mutation_id"?: string | null,"closed_at"?: string | null,"closed_by"?: string | null,"country": string,"created_at"?: string,"created_by": string,"currency": string,"email"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"phone"?: string | null,"slug": string,"tax_id"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"business_type"?: string,"client_mutation_id"?: string | null,"closed_at"?: string | null,"closed_by"?: string | null,"country"?: string,"created_at"?: string,"created_by"?: string,"currency"?: string,"email"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"phone"?: string | null,"slug"?: string,"tax_id"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organizations_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organizations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"permissions": {
                  Row: {
                    "category": string,"created_at": string,"description": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"created_at"?: string,"description": string,"id": string
                  }
                  Update: {
                    "category"?: string,"created_at"?: string,"description"?: string,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"product_categories": {
                  Row: {
                    "archived_at": string | null,"archived_by": string | null,"created_at": string,"created_by": string,"description": string | null,"id": string,"name": string,"organization_id": string,"status": string,"updated_at": string,"updated_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"archived_by"?: string | null,"created_at"?: string,"created_by": string,"description"?: string | null,"id"?: string,"name": string,"organization_id": string,"status"?: string,"updated_at"?: string,"updated_by": string
                  }
                  Update: {
                    "archived_at"?: string | null,"archived_by"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string | null,"id"?: string,"name"?: string,"organization_id"?: string,"status"?: string,"updated_at"?: string,"updated_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_categories_archived_by_fkey"
      columns: ["archived_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_categories_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"product_costs": {
                  Row: {
                    "cost_price": number,"created_at": string,"organization_id": string,"product_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cost_price": number,"created_at"?: string,"organization_id": string,"product_id": string,"updated_at"?: string
                  }
                  Update: {
                    "cost_price"?: number,"created_at"?: string,"organization_id"?: string,"product_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_product_costs_org"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_product_costs_org_product"
      columns: ["organization_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"products": {
                  Row: {
                    "archived_at": string | null,"archived_by": string | null,"barcode": string | null,"category_id": string | null,"created_at": string,"created_by": string,"description": string | null,"id": string,"image_url": string | null,"name": string,"organization_id": string,"selling_price": number,"sku": string,"status": string,"unit_of_measure": string,"updated_at": string,"updated_by": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"archived_by"?: string | null,"barcode"?: string | null,"category_id"?: string | null,"created_at"?: string,"created_by": string,"description"?: string | null,"id"?: string,"image_url"?: string | null,"name": string,"organization_id": string,"selling_price"?: number,"sku": string,"status"?: string,"unit_of_measure"?: string,"updated_at"?: string,"updated_by": string,"version"?: number
                  }
                  Update: {
                    "archived_at"?: string | null,"archived_by"?: string | null,"barcode"?: string | null,"category_id"?: string | null,"created_at"?: string,"created_by"?: string,"description"?: string | null,"id"?: string,"image_url"?: string | null,"name"?: string,"organization_id"?: string,"selling_price"?: number,"sku"?: string,"status"?: string,"unit_of_measure"?: string,"updated_at"?: string,"updated_by"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_products_org_category"
      columns: ["organization_id","category_id"]
isOneToOne: false
      referencedRelation: "product_categories"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "products_archived_by_fkey"
      columns: ["archived_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"first_name": string,"id": string,"last_name": string,"phone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"first_name": string,"id": string,"last_name": string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"first_name"?: string,"id"?: string,"last_name"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"recovery_grants": {
                  Row: {
                    "consumed_at": string | null,"created_at": string,"expires_at": string,"id": string,"nonce_hash": string,"session_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consumed_at"?: string | null,"created_at"?: string,"expires_at": string,"id"?: string,"nonce_hash": string,"session_id": string,"user_id": string
                  }
                  Update: {
                    "consumed_at"?: string | null,"created_at"?: string,"expires_at"?: string,"id"?: string,"nonce_hash"?: string,"session_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"role_permissions": {
                  Row: {
                    "created_at": string,"permission_id": string,"role": Database["public"]['Enums']["app_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"permission_id": string,"role": Database["public"]['Enums']["app_role"]
                  }
                  Update: {
                    "created_at"?: string,"permission_id"?: string,"role"?: Database["public"]['Enums']["app_role"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "role_permissions_permission_id_fkey"
      columns: ["permission_id"]
isOneToOne: false
      referencedRelation: "permissions"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_movement_costs": {
                  Row: {
                    "created_at": string,"currency": string,"movement_id": string,"organization_id": string,"unit_cost": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"currency": string,"movement_id": string,"organization_id": string,"unit_cost": number
                  }
                  Update: {
                    "created_at"?: string,"currency"?: string,"movement_id"?: string,"organization_id"?: string,"unit_cost"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_movement_costs_movement_id_fkey"
      columns: ["movement_id"]
isOneToOne: true
      referencedRelation: "stock_movements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movement_costs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_movements": {
                  Row: {
                    "created_at": string,"created_by": string,"id": string,"idempotency_key": string | null,"idempotency_payload_hash": string | null,"inventory_id": string,"movement_type": string,"organization_id": string,"product_id": string,"quantity_after": number,"quantity_before": number,"quantity_delta": number,"reason": string,"reference_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"id"?: string,"idempotency_key"?: string | null,"idempotency_payload_hash"?: string | null,"inventory_id": string,"movement_type": string,"organization_id": string,"product_id": string,"quantity_after": number,"quantity_before": number,"quantity_delta": number,"reason": string,"reference_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"id"?: string,"idempotency_key"?: string | null,"idempotency_payload_hash"?: string | null,"inventory_id"?: string,"movement_type"?: string,"organization_id"?: string,"product_id"?: string,"quantity_after"?: number,"quantity_before"?: number,"quantity_delta"?: number,"reason"?: string,"reference_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_movements_inventory_composite"
      columns: ["organization_id","inventory_id","product_id"]
isOneToOne: false
      referencedRelation: "inventory"
      referencedColumns: ["organization_id","id","product_id"]
    },{
      foreignKeyName: "fk_movements_org_product"
      columns: ["organization_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "stock_movements_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"zero_delta_stocktakes": {
                  Row: {
                    "created_at": string,"created_by": string,"id": string,"idempotency_key": string,"idempotency_payload_hash": string,"organization_id": string,"product_id": string,"target_physical_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"id"?: string,"idempotency_key": string,"idempotency_payload_hash": string,"organization_id": string,"product_id": string,"target_physical_count": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"id"?: string,"idempotency_key"?: string,"idempotency_payload_hash"?: string,"organization_id"?: string,"product_id"?: string,"target_physical_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "zero_delta_stocktakes_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "zero_delta_stocktakes_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "zero_delta_stocktakes_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "_execute_inventory_mutation_core":
{ Args: { "p_created_by": string,"p_expected_version"?: number,"p_idempotency_key": string,"p_idempotency_payload_hash": string,"p_movement_type": string,"p_org_id": string,"p_product_id": string,"p_quantity_delta": number,"p_reason": string,"p_reference_id": string }; Returns: Json
                           },
"accept_organization_invitation":
{ Args: { "p_token_hash": string }; Returns: Json
                           },
"archive_product":
{ Args: { "p_expected_version": number,"p_org_id": string,"p_product_id": string }; Returns: Json
                           },
"archive_product_category":
{ Args: { "p_category_id": string,"p_org_id": string }; Returns: Json
                           },
"check_user_permission":
{ Args: { "p_org_id": string,"p_permission": string,"p_user_id": string }; Returns: boolean
                           },
"consume_recovery_grant":
{ Args: { "p_nonce_hash": string,"p_user_id"?: string }; Returns: boolean
                           },
"create_organization_invitation":
{ Args: { "p_email": string,"p_expires_at": string,"p_org_id": string,"p_role": Database["public"]['Enums']["app_role"],"p_token_hash": string }; Returns: Json
                           },
"create_organization_with_owner":
{ Args: { "p_address"?: string,"p_business_type": string,"p_client_mutation_id": string,"p_country": string,"p_currency": string,"p_email"?: string,"p_name": string,"p_phone"?: string,"p_slug": string,"p_tax_id"?: string,"p_timezone": string }; Returns: Json
                           },
"create_product":
{ Args: { "p_barcode"?: string,"p_category_id"?: string,"p_cost_price"?: number,"p_description"?: string,"p_image_url"?: string,"p_name": string,"p_org_id": string,"p_selling_price": number,"p_sku": string,"p_status"?: string,"p_unit_of_measure"?: string }; Returns: Json
                           },
"create_product_category":
{ Args: { "p_description"?: string,"p_name": string,"p_org_id": string }; Returns: Json
                           },
"create_recovery_grant":
{ Args: { "p_expires_at": string,"p_nonce_hash": string,"p_session_id": string,"p_user_id"?: string }; Returns: string
                           },
"decline_organization_invitation":
{ Args: { "p_token_hash": string }; Returns: Json
                           },
"execute_stock_movement":
{ Args: { "p_expected_version"?: number,"p_idempotency_key"?: string,"p_movement_type": string,"p_org_id": string,"p_product_id": string,"p_quantity": number,"p_quantity_semantics"?: string,"p_reason": string,"p_reference_id"?: string }; Returns: Json
                           },
"get_currency_exponent":
{ Args: { "p_currency": string }; Returns: number
                           },
"get_organization_employees":
{ Args: { "p_org_id": string }; Returns: {
              "email": string,"first_name": string,"joined_at": string,"last_name": string,"membership_id": string,"phone": string,"role": Database["public"]['Enums']["app_role"],"status": Database["public"]['Enums']["membership_status"],"user_id": string
            }[]
                           },
"get_user_organization_ids":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"is_email_verified":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_org_member":
{ Args: { "p_org_id": string,"p_roles"?: (Database["public"]['Enums']["app_role"])[] }; Returns: boolean
                           },
"resend_organization_invitation":
{ Args: { "p_invitation_id": string,"p_new_expires_at": string,"p_new_token_hash": string }; Returns: Json
                           },
"restore_product":
{ Args: { "p_expected_version": number,"p_org_id": string,"p_product_id": string }; Returns: Json
                           },
"restore_product_category":
{ Args: { "p_category_id": string,"p_org_id": string }; Returns: Json
                           },
"revoke_organization_invitation":
{ Args: { "p_invitation_id": string }; Returns: Json
                           },
"show_limit":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"show_trgm":
{ Args: { "": string }; Returns: (string)[]
                           },
"toggle_product_status":
{ Args: { "p_expected_version": number,"p_new_status": string,"p_org_id": string,"p_product_id": string }; Returns: Json
                           },
"update_inventory_thresholds":
{ Args: { "p_expected_version"?: number,"p_org_id": string,"p_product_id": string,"p_reorder_point": number,"p_reorder_quantity": number }; Returns: Json
                           },
"update_organization_member_role":
{ Args: { "p_new_role": Database["public"]['Enums']["app_role"],"p_org_id": string,"p_target_membership_id": string }; Returns: Json
                           },
"update_organization_member_status":
{ Args: { "p_new_status": Database["public"]['Enums']["membership_status"],"p_org_id": string,"p_target_membership_id": string }; Returns: Json
                           },
"update_product":
{ Args: { "p_barcode"?: string,"p_category_id"?: string,"p_cost_operation"?: string,"p_cost_price"?: number,"p_description"?: string,"p_expected_version": number,"p_image_url"?: string,"p_name": string,"p_org_id": string,"p_product_id": string,"p_selling_price": number,"p_sku": string,"p_unit_of_measure"?: string }; Returns: Json
                           },
"update_product_category":
{ Args: { "p_category_id": string,"p_description"?: string,"p_name": string,"p_org_id": string }; Returns: Json
                           },
"validate_invitation_token":
{ Args: { "p_token_hash": string }; Returns: Json
                           },
"verify_recovery_grant":
{ Args: { "p_nonce_hash": string,"p_user_id"?: string }; Returns: boolean
                           }
          }
          Enums: {
            "app_role": "owner"|"admin"|"manager"|"cashier","invitation_status": "pending"|"accepted"|"declined"|"revoked"|"expired","membership_status": "active"|"suspended"|"revoked"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_role": ["owner", "admin", "manager", "cashier"],"invitation_status": ["pending", "accepted", "declined", "revoked", "expired"],"membership_status": ["active", "suspended", "revoked"]
          }
        }
} as const
