import { PDFDocument } from "pdf-lib";
import cloudinary from "../config/cloudinary.js";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const mergePdfs = async (req, res) => {
  try {
    const { university, semester, subject, subSubject } = req.params;

    if (!university || !semester || !subject) {
      return res.status(400).json({ success: false, message: "Missing parameters" });
    }

    const cloudinaryFolder = subSubject
      ? `noteshub/${university}/${semester}/${subject}/${subSubject}`
      : `noteshub/${university}/${semester}/${subject}`;

    const supabasePath = subSubject
      ? `${university}/${semester}/${subject}/${subSubject}`
      : `${university}/${semester}/${subject}`;

    let cloudinaryUrls = [];
    try {
      const result = await cloudinary.api.resources_by_asset_folder(cloudinaryFolder, { max_results: 100 });
      cloudinaryUrls = (result.resources || [])
        .filter(f => f.format === "pdf")
        .map(f => ({ name: f.display_name || f.public_id.split("/").pop(), url: f.secure_url }));
    } catch (e) {
      // console.warn("Cloudinary folder not found:", cloudinaryFolder);
    }

    let supabaseUrls = [];
    try {
      const { data, error } = await supabase.storage.from("notes").list(supabasePath, { limit: 100 });
      if (!error && data) {
        supabaseUrls = data
          .filter(f => f.name.endsWith(".pdf"))
          .map(f => {
            const { data: urlData } = supabase.storage.from("notes").getPublicUrl(`${supabasePath}/${f.name}`);
            return { name: f.name, url: urlData.publicUrl };
          });
      }
    } catch (e) {
      console.warn("Supabase fetch failed:", e.message);
    }

    const allFiles = [...cloudinaryUrls, ...supabaseUrls].sort((a, b) => {
      const aNum = parseInt(a.name);
      const bNum = parseInt(b.name);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      if (!isNaN(aNum)) return -1;
      if (!isNaN(bNum)) return 1;
      return a.name.localeCompare(b.name);
    });

    if (allFiles.length === 0) {
      return res.status(404).json({ success: false, message: "No PDF files found" });
    }

    const pdfBuffers = await Promise.all(
      allFiles.map(async (file) => {
        const response = await fetch(file.url);
        if (!response.ok) throw new Error(`Failed to fetch ${file.name}`);
        return response.arrayBuffer();
      })
    );

    const mergedPdf = await PDFDocument.create();

    for (const buffer of pdfBuffers) {
      try {
        const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach(page => mergedPdf.addPage(page));
      } catch (e) {
        console.warn("Skipping PDF:", e.message);
      }
    }

    const mergedBytes = await mergedPdf.save();
    const folderLabel = subSubject || subject;
    const fileName = `${folderLabel}-complete-material.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", mergedBytes.length);
    res.send(Buffer.from(mergedBytes));

  } catch (error) {
    console.error("Merge error:", error);
    res.status(500).json({ success: false, message: error.message || "Merge failed" });
  }
};