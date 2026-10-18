import { v2 as cloudinary } from "cloudinary";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_CLOUDINARY_SIZE = 10 * 1024 * 1024;

const uploadPdf = async (filePath, folder) => {
  try {
    const fileSize = fs.statSync(filePath).size;
    const fileName = path.basename(filePath);

    if (fileSize <= MAX_CLOUDINARY_SIZE) {
      console.log("📤 Uploading to Cloudinary...");
      const result = await cloudinary.uploader.upload(filePath, {
        resource_type: "image",
        folder: `noteshub/${folder}`,
        use_filename: true,
        unique_filename: true,
      });
      console.log("✅ Uploaded to Cloudinary:", result.secure_url);
    } else {
      console.log("📤 File too large for Cloudinary, uploading to Supabase...");
      const fileBuffer = fs.readFileSync(filePath);
      const supabasePath = `${folder}/${fileName}`;
      const { error } = await supabase.storage
        .from("notes")
        .upload(supabasePath, fileBuffer, {
          contentType: "application/pdf",
          upsert: true
        });
      if (error) throw error;
      const { data } = supabase.storage
        .from("notes")
        .getPublicUrl(supabasePath);
      console.log("✅ Uploaded to Supabase:", data.publicUrl);
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
};

uploadPdf(
  "C:/Users/SHAHO/Music/ste-sem5-manual.pdf",
  "msbte/sem5/manual"
);