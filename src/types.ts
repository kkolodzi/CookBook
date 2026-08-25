export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      extraction_attempts: {
        Row: {
          created_at: string;
          failure_reason: Database["public"]["Enums"]["extraction_failure_reason"] | null;
          id: string;
          raw_response: Json | null;
          recipe_id: string | null;
          success: boolean;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          failure_reason?: Database["public"]["Enums"]["extraction_failure_reason"] | null;
          id?: string;
          raw_response?: Json | null;
          recipe_id?: string | null;
          success: boolean;
          user_id: string;
        };
        Update: {
          created_at?: string;
          failure_reason?: Database["public"]["Enums"]["extraction_failure_reason"] | null;
          id?: string;
          raw_response?: Json | null;
          recipe_id?: string | null;
          success?: boolean;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "extraction_attempts_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
      extraction_daily_counters: {
        Row: {
          count: number;
          day: string;
          user_id: string;
        };
        Insert: {
          count?: number;
          day?: string;
          user_id: string;
        };
        Update: {
          count?: number;
          day?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      recipe_ingredients: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          position: number;
          recipe_id: string;
          search_key: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          position?: number;
          recipe_id: string;
          search_key?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          position?: number;
          recipe_id?: string;
          search_key?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
      recipes: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          id: string;
          instructions: string | null;
          name: string;
          photo_path: string;
          type: Database["public"]["Enums"]["recipe_type"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          instructions?: string | null;
          name: string;
          photo_path: string;
          type: Database["public"]["Enums"]["recipe_type"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          instructions?: string | null;
          name?: string;
          photo_path?: string;
          type?: Database["public"]["Enums"]["recipe_type"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      edit_recipe: {
        Args: {
          p_ingredients: string[];
          p_instructions?: string;
          p_name: string;
          p_recipe_id: string;
          p_type: Database["public"]["Enums"]["recipe_type"];
        };
        Returns: boolean;
      };
      normalize_polish_ingredient: { Args: { p_text: string }; Returns: string };
      reserve_extraction_attempt: { Args: { p_cap: number }; Returns: boolean };
      search_recipes_by_ingredient: {
        Args: {
          p_query: string;
          p_type?: Database["public"]["Enums"]["recipe_type"];
        };
        Returns: {
          created_at: string;
          id: string;
          name: string;
          photo_path: string;
          type: Database["public"]["Enums"]["recipe_type"];
        }[];
      };
    };
    Enums: {
      extraction_failure_reason:
        | "not_a_recipe"
        | "blurry_or_low_light"
        | "cut_off_or_partial"
        | "handwriting_illegible"
        | "incomplete_extraction"
        | "technical_error";
      recipe_type: "dessert" | "soup" | "main_course" | "salad" | "breakfast" | "snack" | "drink" | "other";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      extraction_failure_reason: [
        "not_a_recipe",
        "blurry_or_low_light",
        "cut_off_or_partial",
        "handwriting_illegible",
        "incomplete_extraction",
        "technical_error",
      ],
      recipe_type: ["dessert", "soup", "main_course", "salad", "breakfast", "snack", "drink", "other"],
    },
  },
} as const;

export interface RecipeSummaryDto {
  id: string;
  name: string;
  type: Database["public"]["Enums"]["recipe_type"];
  createdAt: string;
  photoUrl: string | null;
}

export interface RecipeIngredientDto {
  id: string;
  name: string;
  position: number;
}

export interface RecipeDetailDto {
  id: string;
  name: string;
  type: Database["public"]["Enums"]["recipe_type"];
  createdAt: string;
  photoUrl: string | null;
  ingredients: RecipeIngredientDto[];
  instructions: string | null;
}
