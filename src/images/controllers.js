const express = require("express");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const osDownloadMap = require("../utils/os-mapping");
const { executeCommand } = require("../utils/helper");
const ISO_DOWNLOAD_PATH = "/var/lib/libvirt/images/isos"; // Adjust as needed

// GET /api/isos - List available ISO images
router.get("/api/isos", async (req, res) => {
  try {
    fs.readdir(ISO_DOWNLOAD_PATH, (err, files) => {
      console.log("files ", files);
      if (files) {
        const isos = files.filter((file) => file.endsWith(".iso"));
        res.json(isos);
      }
      res.json([]);
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to list ISOs", details: error });
  }
});

// Function to download an ISO image using wget
const downloadISO = async (url, filename) => {
  console.log("url ", url);

  const outputPath = path.join(ISO_DOWNLOAD_PATH, filename);
  const command = `wget -O "${outputPath}" "${url}"`;
  console.log("command ", command);

  console.log(`Downloading ${filename} from ${url} to ${outputPath}`);
  try {
    await executeCommand(command, 300000); // 5 minutes timeout
    console.log(`Successfully downloaded ${filename}`);
    return outputPath;
  } catch (error) {
    console.error(`Error downloading ${filename}: ${error}`);
  }
};

// POST /api/download/:osName - Download ISO based on OS name parameter
router.get("/api/download/:osName", async (req, res) => {
  const osName = req.params.osName.toLowerCase(); // Convert to lowercase for case-insensitive matching

  if (!osDownloadMap[osName]) {
    return res.status(400).json({
      error: `Unsupported OS name: ${osName}. Available options: ${Object.keys(
        osDownloadMap
      ).join(", ")}`,
    });
  }

  const { url, filename } = osDownloadMap[osName];

  downloadISO(url, filename).catch((error) => {
    console.error("Download failed:", error);
  });
  res.json({
    message: `${osName} ISO downloading started. It will appear on the list once downloaded`,
  });
});

module.exports = router;
