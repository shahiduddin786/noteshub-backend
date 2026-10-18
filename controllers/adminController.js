import { v2 as cloudinary } from "cloudinary";
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import os from "os";
import path from "path";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_CLOUDINARY_SIZE = 10 * 1024 * 1024;

export const adminUpload = async (req, res) => {
  try {
    const { folder } = req.body;
    if (!folder) return res.status(400).json({ success: false, message: "folder is required" });
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;
    const fileSize = fileBuffer.length;

    if (fileSize <= MAX_CLOUDINARY_SIZE) {
      const tempPath = path.join(os.tmpdir(), fileName);
      fs.writeFileSync(tempPath, fileBuffer);

      const result = await cloudinary.uploader.upload(tempPath, {
        resource_type: "image",
        folder: `noteshub/${folder}`,
        use_filename: true,
        unique_filename: true,
      });

      fs.unlinkSync(tempPath);

      return res.status(200).json({
        success: true,
        message: "Uploaded to Cloudinary",
        url: result.secure_url,
        provider: "cloudinary",
      });
    } else {
      const supabasePath = `${folder}/${fileName}`;

      const { error } = await supabase.storage
        .from("notes")
        .upload(supabasePath, fileBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (error) throw error;

      const { data } = supabase.storage.from("notes").getPublicUrl(supabasePath);

      return res.status(200).json({
        success: true,
        message: "Uploaded to Supabase",
        url: data.publicUrl,
        provider: "supabase",
      });
    }
  } catch (error) {
    console.error("Admin upload error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const adminListFolders = async (req, res) => {
  try {
    const { path: folderPath } = req.query;
    const cloudinaryFolders = [];
    try {
      const result = await cloudinary.api.sub_folders(
        folderPath ? `noteshub/${folderPath}` : "noteshub"
      );
      result.folders.forEach((f) => cloudinaryFolders.push(f.name));
    } catch (e) {}

    return res.status(200).json({ success: true, folders: cloudinaryFolders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const adminListCloudinaryFiles = async (req, res) => {
  try {
    const { folder } = req.query;
    const folderPath = folder ? `noteshub/${folder}` : "noteshub";

    const result = await cloudinary.api.resources_by_asset_folder(folderPath, {
      max_results: 100,
    });

    const files = (result.resources || []).map((f) => ({
      name: f.display_name || f.public_id.split("/").pop(),
      url: f.secure_url,
      public_id: f.public_id,
      size: f.bytes,
      created_at: f.created_at,
    }));

    const subFolders = [];
    try {
      const sf = await cloudinary.api.sub_folders(folderPath);
      sf.folders.forEach((f) => subFolders.push(f.name));
    } catch (e) {}

    return res.status(200).json({ success: true, files, folders: subFolders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const adminDeleteCloudinaryFile = async (req, res) => {
  try {
    const { public_id } = req.body;
    if (!public_id) return res.status(400).json({ success: false, message: "public_id required" });

    await cloudinary.uploader.destroy(public_id, { resource_type: "image" });

    return res.status(200).json({ success: true, message: "Deleted from Cloudinary" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const adminListSupabaseFiles = async (req, res) => {
  try {
    const { folder } = req.query;
    const folderPath = folder || "";

    const { data, error } = await supabase.storage
      .from("notes")
      .list(folderPath, { limit: 100 });

    if (error) throw error;

    const folders = (data || []).filter((i) => i.id === null).map((i) => i.name);
    const files = (data || [])
      .filter((i) => i.id !== null && i.name.endsWith(".pdf"))
      .map((i) => {
        const filePath = folderPath ? `${folderPath}/${i.name}` : i.name;
        const { data: urlData } = supabase.storage.from("notes").getPublicUrl(filePath);
        return {
          name: i.name,
          url: urlData.publicUrl,
          path: filePath,
          size: i.metadata?.size || 0,
          created_at: i.created_at,
        };
      });

    return res.status(200).json({ success: true, files, folders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const adminDeleteSupabaseFile = async (req, res) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ success: false, message: "path required" });

    const { error } = await supabase.storage.from("notes").remove([filePath]);
    if (error) throw error;

    return res.status(200).json({ success: true, message: "Deleted from Supabase" });
  } catch (error) {
  return res.status(500).json({ success: false, message: error.message });
  }
};

export const adminCreateCloudinaryFolder = async (req, res) => {
  try {
    const { path: folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ success: false, message: "path required" });
    await cloudinary.api.create_folder(`noteshub/${folderPath}`);
    return res.status(200).json({ success: true, message: "Folder created" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const adminRenameCloudinaryFolder = async (req, res) => {
  try {
    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) return res.status(400).json({ success: false, message: "oldPath and newName required" });
    const parentPath = oldPath.includes("/") ? oldPath.substring(0, oldPath.lastIndexOf("/")) : "";
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    await cloudinary.api.create_folder(`noteshub/${newPath}`);
    const result = await cloudinary.api.resources_by_asset_folder(`noteshub/${oldPath}`, { max_results: 500 });
    const resources = result.resources || [];
    await Promise.all(
      resources.map((r) => {
        const fileName = r.public_id.split("/").pop();
        return cloudinary.uploader.rename(r.public_id, `noteshub/${newPath}/${fileName}`, { resource_type: "image" });
      })
    );
    if (resources.length === 0) {
      await cloudinary.api.delete_folder(`noteshub/${oldPath}`);
    } else {
      try { await cloudinary.api.delete_folder(`noteshub/${oldPath}`); } catch (e) {}
    }
    return res.status(200).json({ success: true, message: "Folder renamed" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const adminDeleteCloudinaryFolder = async (req, res) => {
  try {
    const { path: folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ success: false, message: "path required" });
    const result = await cloudinary.api.resources_by_asset_folder(`noteshub/${folderPath}`, { max_results: 500 });
    const publicIds = (result.resources || []).map((r) => r.public_id);
    if (publicIds.length > 0) {
      await cloudinary.api.delete_resources(publicIds, { resource_type: "image" });
    }
    await cloudinary.api.delete_folder(`noteshub/${folderPath}`);
    return res.status(200).json({ success: true, message: "Folder deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const adminCreateSupabaseFolder = async (req, res) => {
  try {
    const { path: folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ success: false, message: "path required" });
    const placeholder = Buffer.from("");
    const { error } = await supabase.storage
      .from("notes")
      .upload(`${folderPath}/.keep`, placeholder, { contentType: "application/octet-stream", upsert: true });
    if (error) throw error;
    return res.status(200).json({ success: true, message: "Folder created" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const adminRenameSupabaseFolder = async (req, res) => {
  try {
    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) return res.status(400).json({ success: false, message: "oldPath and newName required" });
    const parentPath = oldPath.includes("/") ? oldPath.substring(0, oldPath.lastIndexOf("/")) : "";
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    const { data, error } = await supabase.storage.from("notes").list(oldPath, { limit: 500 });
    if (error) throw error;
    const items = data || [];
    await Promise.all(
      items.map((item) =>
        supabase.storage.from("notes").move(`${oldPath}/${item.name}`, `${newPath}/${item.name}`)
      )
    );
    return res.status(200).json({ success: true, message: "Folder renamed" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const adminDeleteSupabaseFolder = async (req, res) => {
  try {
    const { path: folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ success: false, message: "path required" });
    const { data, error } = await supabase.storage.from("notes").list(folderPath, { limit: 500 });
    if (error) throw error;
    const filePaths = (data || []).map((item) => `${folderPath}/${item.name}`);
    if (filePaths.length > 0) {
      const { error: removeError } = await supabase.storage.from("notes").remove(filePaths);
      if (removeError) throw removeError;
    }
    return res.status(200).json({ success: true, message: "Folder deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};