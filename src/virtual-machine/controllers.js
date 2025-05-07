const express = require("express");
const router = express.Router();
const osDownloadMap = require("../utils/os-mapping");
const {
  executeCommand,
  parseCMDResponse,
} = require("../utils/helper");
const path = require("path");
const fs = require("fs");
const {createKvmVm} = require('./service');
const VM_IMAGE_BASE_PATH = "/var/lib/libvirt/images"; // Adjust as needed

router.post("/api/vms", createKvmVm);

// GET /api/vms - List all virtual machines
router.get("/api/vms", async (req, res) => {
  try {
    const output = await executeCommand("virsh list --all");
    res.json(parseCMDResponse(output));
  } catch (error) {
    res.status(500).json({ error: "Failed to list VMs", details: error });
  }
});

// GET /api/vms/:name - Get details of a specific VM
router.get("/api/vms/:name", async (req, res) => {
  const vmName = req.params.name;
  try {
    const output = await executeCommand(`virsh dominfo ${vmName}`);
    const output2 = await executeCommand(`virsh domifaddr ${vmName}`);
    
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const vmInfo = {};
    lines.forEach((line) => {
      const [key, value] = line.split(":").map((item) => item.trim());
      vmInfo[key] = value;
    });
    res.json({...vmInfo, ...parseCMDResponse(output2)[0]});
  } catch (error) {
    res.status(404).json({
      error: `VM "${vmName}" not found or details unavailable`,
      details: error,
    });
  }
});

// POST /api/vms/:name/start - Start a virtual machine
router.post("/api/vms/:name/start", async (req, res) => {
  const vmName = req.params.name;
  try {
    const output = await executeCommand(`virsh start ${vmName}`);
    res.json({
      message: `VM "${vmName}" started successfully`,
      details: output,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: `Failed to start VM "${vmName}"`, details: error });
  }
});

// POST /api/vms/:name/stop - Stop a virtual machine (graceful shutdown)
router.post("/api/vms/:name/stop", async (req, res) => {
  const vmName = req.params.name;
  try {
    const output = await executeCommand(`virsh shutdown ${vmName}`);
    res.json({
      message: `VM "${vmName}" shut down successfully`,
      details: output,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: `Failed to shut down VM "${vmName}"`, details: error });
  }
});

// POST /api/vms/:name/poweroff - Forcefully power off a virtual machine
router.post("/api/vms/:name/poweroff", async (req, res) => {
  const vmName = req.params.name;
  try {
    const output = await executeCommand(`virsh destroy ${vmName}`);
    res.json({
      message: `VM "${vmName}" powered off forcefully`,
      details: output,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: `Failed to power off VM "${vmName}"`, details: error });
  }
});

// DELETE /api/vms/:name - Delete a virtual machine
router.delete("/api/vms/:name", async (req, res) => {
  const vmName = req.params.name;

  try {
    // 1. Undefine the VM (this will stop it if it's running)
    const undefineOutput = await executeCommand(`virsh undefine ${vmName}`);
    await executeCommand(`virsh destroy ${vmName}`);
    console.log(`VM "${vmName}" undefined: ${undefineOutput}`);

    // 2. Optionally, delete the associated disk image file
    const imageName = `${vmName}.qcow2`;
    const diskPath = path.join(VM_IMAGE_BASE_PATH, imageName);

    try {
      await fs.unlink(diskPath, (err) => {
        err ? console.log(err) : "";
      });
      console.log(`Disk image "${diskPath}" deleted.`);
    } catch (err) {
      if (err.code === "ENOENT") {
        console.log(`Disk image "${diskPath}" not found, skipping deletion.`);
      } else {
        console.error(`Error deleting disk image "${diskPath}": ${err}`);
        // Optionally, you might want to still consider the VM deletion successful
        // even if disk deletion fails, or return an error.
      }
    }

    res.json({ message: `VM "${vmName}" deleted successfully.` });
  } catch (error) {
    console.error(`Error deleting VM "${vmName}":`, error);
    res
      .status(500)
      .json({ error: `Failed to delete VM "${vmName}"`, details: error });
  }
});

module.exports = router;
