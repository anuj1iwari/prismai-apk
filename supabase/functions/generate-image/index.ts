import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ratioInstructions: Record<string, string> = {
  "1:1": "Square composition, centered subject, balanced framing, equal visual space on all sides.",
  "16:9": "Wide landscape composition, panoramic framing, horizontal visual arrangement.",
  "9:16": "Vertical portrait composition, tall framing, vertical visual arrangement.",
  "4:3": "Classic landscape composition, balanced rectangular framing.",
};

Deno.serve(async (req) => {
  let adminSupabase: any = null;
  let reservedUserId: string | null = null;
  let uploadedFilePath: string | null = null;

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Verify logged-in user
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: {
          headers: { Authorization: authHeader },
        },
      },
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Admin client
    adminSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Read request
    const body = await req.json();

    const { prompt, ratio = "1:1", quality = "Standard" } = body;

    // Validate prompt
    if (
      typeof prompt !== "string" ||
      !prompt.trim() ||
      prompt.length > 2048
    ) {
      return new Response(
        JSON.stringify({
          error: "Invalid prompt. Maximum 2048 characters.",
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Validate aspect ratio
    if (!ratioInstructions[ratio]) {
      return new Response(
        JSON.stringify({ error: "Invalid aspect ratio." }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Validate quality
    if (!["Standard", "HD"].includes(quality)) {
      return new Response(
        JSON.stringify({ error: "Invalid image quality." }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Check subscription
    const { data: subscription, error: subscriptionError } =
      await adminSupabase
        .from("user_subscriptions")
        .select("plan_type, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .in("plan_type", ["monthly", "yearly"])
        .maybeSingle();

    if (subscriptionError) {
      throw new Error("Unable to verify subscription");
    }

    const dailyLimit = subscription ? 20 : 2;

    // Reserve daily generation quota
    const { data: allowed, error: limitError } =
      await adminSupabase.rpc(
        "reserve_image_generation",
        {
          p_user_id: user.id,
          p_daily_limit: dailyLimit,
        },
      );

    if (limitError) {
      throw new Error("Unable to verify image generation limit");
    }

    if (!allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Daily image limit reached (${dailyLimit} images per day).`,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    reservedUserId = user.id;

    // Cloudflare configuration
    const apiToken = Deno.env.get("CLOUDFLARE_API_TOKEN");
    const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");

    if (!apiToken || !accountId) {
      throw new Error("Cloudflare configuration missing");
    }

    // Quality settings
    const steps = quality === "HD" ? 8 : 4;

    // Add composition instructions
    const enhancedPrompt =
      `${prompt.trim()}. ${ratioInstructions[ratio]}`;

    // Generate image using FLUX.1 Schnell
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: enhancedPrompt,
          steps,
        }),
      },
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Cloudflare error:", result.errors);
      throw new Error("Image generation failed");
    }

    const image = result.result?.image || result.image;

    if (!image || typeof image !== "string") {
      throw new Error("No image returned by Cloudflare");
    }

    // Convert base64 to image bytes
    const bytes = Uint8Array.from(
      atob(image),
      (char) => char.charCodeAt(0),
    );

    // Save image in user's private folder
    const filePath = `${user.id}/${crypto.randomUUID()}.jpg`;

    uploadedFilePath = filePath;

    const { error: uploadError } = await adminSupabase.storage
      .from("generated-images")
      .upload(
        filePath,
        new Blob([bytes], { type: "image/jpeg" }),
        {
          contentType: "image/jpeg",
          upsert: false,
        },
      );

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      throw new Error("Unable to save generated image");
    }

    // Create temporary signed URL
    const { data: signedData, error: signedError } =
      await adminSupabase.storage
        .from("generated-images")
        .createSignedUrl(filePath, 3600);

    if (signedError || !signedData) {
      throw new Error("Unable to create image URL");
    }

    // Success
    reservedUserId = null;

    return new Response(
      JSON.stringify({
        success: true,
        imageUrl: signedData.signedUrl,
        path: filePath,
        ratio,
        quality,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("Image generation error:", error);

    // Remove partially uploaded image
    if (adminSupabase && uploadedFilePath) {
      const { error: deleteError } = await adminSupabase.storage
        .from("generated-images")
        .remove([uploadedFilePath]);

      if (deleteError) {
        console.error("Storage cleanup error:", deleteError);
      }
    }

    // Refund reserved quota on failure
    if (adminSupabase && reservedUserId) {
      const { error: refundError } = await adminSupabase.rpc(
        "release_image_generation",
        {
          p_user_id: reservedUserId,
        },
      );

      if (refundError) {
        console.error("Usage refund error:", refundError);
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: "Unable to generate image. Please try again.",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});