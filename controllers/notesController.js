import cloudinary from "../config/cloudinary.js";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const getNotes = async (req, res) => {
  try {
    const { university, semester, subject, subSubject } = req.params;

    if (!university || !semester || !subject) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters"
      });
    }

    const folderPath = subSubject
      ? `noteshub/${university}/${semester}/${subject}/${subSubject}`
      : `noteshub/${university}/${semester}/${subject}`;

    const supabasePath = subSubject
      ? `${university}/${semester}/${subject}/${subSubject}`
      : `${university}/${semester}/${subject}`;

let cloudinaryNotes = [];
try {
  const cloudinaryResult = await cloudinary.api.resources_by_asset_folder(folderPath, {
    max_results: 100
  });
  cloudinaryNotes = (cloudinaryResult.resources || []).map(file => ({
    name: file.display_name || file.public_id.split("/").pop(),
    url: file.secure_url,
    provider: "cloudinary"
  }));
} catch (e) {
  // console.warn("Cloudinary folder not found:", folderPath);
}

    const { data: supabaseFiles, error } = await supabase.storage
      .from("notes")
      .list(supabasePath, { limit: 100 });

    const supabaseNotes = [];
    if (!error && supabaseFiles && supabaseFiles.length > 0) {
      supabaseFiles
        .filter(f => f.name.endsWith(".pdf"))
        .forEach(file => {
          const { data } = supabase.storage
            .from("notes")
            .getPublicUrl(`${supabasePath}/${file.name}`);
          supabaseNotes.push({
            name: file.name,
            url: data.publicUrl,
            provider: "supabase"
          });
        });
    }

    const allNotes = [...cloudinaryNotes, ...supabaseNotes];

    if (allNotes.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Notes not found"
      });
    }

    res.status(200).json({
      success: true,
      count: allNotes.length,
      notes: allNotes
    });

  } catch (error) {
    console.log("Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Server error"
    });
  }
};