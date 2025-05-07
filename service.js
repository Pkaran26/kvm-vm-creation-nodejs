const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const util = require("util");
const osDownloadMap = require('../utils/os-mapping');
const execPromise = util.promisify(exec);

async function createKvmVm(
    req, res) {
      const {name,
        memory,
        vcpu,
        diskSizeGB = 20,
        isoImageName,
        network,
        ssh} = req.body;
  // --- Configuration ---
  const VM_NAME = name; //"ubuntu-noble-vm-2";
  const SELECTED_OS = osDownloadMap[isoImageName];
  if (!SELECTED_OS) 
    return res.status(400).json({error: 'isoImageName is invalid'})

  const OS_IMAGE_URL = SELECTED_OS.url;
  const DOWNLOAD_DIR = "./vm_images"; // Directory to store downloaded and created images
  const BASE_IMAGE_NAME = SELECTED_OS.filename;
  const VM_DISK_NAME = `${VM_NAME}.qcow2`;
  const CLOUD_INIT_ISO_NAME = `${VM_NAME}-cloud-init.iso`;

  // VM Specs
  const VM_MEMORY = memory.toString();//"3072"; // MB
  const VM_VCPUS = vcpu.toString(); //"2";
  const VM_DISK_SIZE = diskSizeGB > 20? `${diskSizeGB}G` : "20G"; // Size for the new VM disk based on the cloud image

  // Cloud-init User Data
  // IMPORTANT: Replace with your actual public SSH key
  const SSH_PUBLIC_KEY = ssh;
    //"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIS0mmbs3DZBIiJRvxdOQYT0L44+IButThC+egyUBU/+ Indiqus";
  const USERNAME = "ubuntu"; // Default user for Ubuntu cloud images
  const HOSTNAME = VM_NAME;

  // Paths
  const baseImagePath = path.join(DOWNLOAD_DIR, BASE_IMAGE_NAME);
  const vmDiskPath = path.join(DOWNLOAD_DIR, VM_DISK_NAME);
  const cloudInitDir = path.join(DOWNLOAD_DIR, "cloud-init-data");
  const userDataPath = path.join(cloudInitDir, "user-data");
  const metaDataPath = path.join(cloudInitDir, "meta-data");
  const cloudInitIsoPath = path.join(DOWNLOAD_DIR, CLOUD_INIT_ISO_NAME);

  // --- Helper Functions ---
  async function runCommand(command, description) {
    console.log(`\n[INFO] Running: ${description}`);
    console.log(`$ ${command}`);
    try {
      const { stdout, stderr } = await execPromise(command);
      if (stdout) console.log(`[STDOUT]\n${stdout}`);
      if (stderr) console.warn(`[STDERR]\n${stderr}`); // Some tools output info to stderr
      return { stdout, stderr };
    } catch (error) {
      console.error(`[ERROR] Failed to ${description.toLowerCase()}:`);
      console.error(error.stderr || error.stdout || error.message);
      throw error;
    }
  }

  function createDirectories() {
    console.log("[INFO] Creating necessary directories...");
    [DOWNLOAD_DIR, cloudInitDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
      }
    });
  }
  try {
    console.log("--- Starting KVM VM Creation Script ---");

    createDirectories();

    // 1. Download the cloud image (if it doesn't exist)
    if (!fs.existsSync(baseImagePath)) {
      await runCommand(
        `wget -O ${baseImagePath} ${OS_IMAGE_URL}`,
        "Download Ubuntu cloud image"
      );
    } else {
      console.log(
        `[INFO] Base image ${baseImagePath} already exists. Skipping download.`
      );
    }

    // 2. Create a VM-specific disk based on the cloud image
    //    This creates a copy-on-write overlay, keeping the base image clean.
    if (fs.existsSync(vmDiskPath)) {
      console.warn(
        `[WARN] VM disk ${vmDiskPath} already exists. Deleting and recreating.`
      );
      fs.unlinkSync(vmDiskPath);
    }
    await runCommand(
      `qemu-img create -f qcow2 -b ${path.basename(
        baseImagePath
      )} -F qcow2 ${vmDiskPath} ${VM_DISK_SIZE}`,
      `Create VM disk ${VM_DISK_NAME} based on ${BASE_IMAGE_NAME}`
    );
    // Alternatively, to resize the base image itself (less ideal for reusability):
    // await runCommand(`qemu-img resize ${baseImagePath} ${VM_DISK_SIZE}`, 'Resize base image');
    // And then copy it for the VM:
    // await runCommand(`cp ${baseImagePath} ${vmDiskPath}`, 'Copy base image for VM');

    // 3. Prepare cloud-init data
    console.log("[INFO] Preparing cloud-init data...");
    const userDataContent = `\
#cloud-config
users:
  - name: ${USERNAME}
    sudo: ALL=(ALL) NOPASSWD:ALL
    groups: users, admin
    home: /home/${USERNAME}
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys:
      - ${SSH_PUBLIC_KEY}
hostname: ${HOSTNAME}
manage_etc_hosts: true
# Optional: Update packages on first boot
# package_update: true
# package_upgrade: true
# packages:
#  - qemu-guest-agent
# runcmd:
#  - [ systemctl, enable, qemu-guest-agent.service ]
#  - [ systemctl, start, --no-block, qemu-guest-agent.service ]
`;
    fs.writeFileSync(userDataPath, userDataContent);

    const metaDataContent = `\
instance-id: ${VM_NAME}-instance-01
local-hostname: ${HOSTNAME}
`;
    fs.writeFileSync(metaDataPath, metaDataContent);
    console.log(`Cloud-init user-data written to: ${userDataPath}`);
    console.log(`Cloud-init meta-data written to: ${metaDataPath}`);

    // 4. Create cloud-init ISO
    // Ensure 'genisoimage' or 'mkisofs' is installed.
    // The volume ID 'cidata' is standard for cloud-init.
    if (fs.existsSync(cloudInitIsoPath)) {
      console.warn(
        `[WARN] Cloud-init ISO ${cloudInitIsoPath} already exists. Deleting and recreating.`
      );
      fs.unlinkSync(cloudInitIsoPath);
    }
    // Check for genisoimage, fallback to mkisofs
    let isoCommand = "genisoimage";
    try {
      await execPromise("command -v genisoimage");
    } catch (e) {
      console.log("[INFO] genisoimage not found, trying mkisofs.");
      try {
        await execPromise("command -v mkisofs");
        isoCommand = "mkisofs";
      } catch (e2) {
        console.error(
          "[ERROR] Neither genisoimage nor mkisofs found. Please install one of them."
        );
        throw e2;
      }
    }

    await runCommand(
      `${isoCommand} -output ${cloudInitIsoPath} -volid cidata -joliet -rock ${userDataPath} ${metaDataPath}`,
      `Create cloud-init ISO ${CLOUD_INIT_ISO_NAME}`
    );

    // 5. Create and start the VM using virt-install
    //    Note: virt-install often requires sudo privileges.
    //    --import tells virt-install to use an existing disk image.
    //    --os-variant helps libvirt optimize for the guest OS.
    //    You might need to adjust --network based on your setup (e.g., bridge=br0).
    //    'ubuntu22.04' or 'ubuntu24.04' might be more specific os-variants if available.
    //    Run 'osinfo-query os' to see available OS variants.
    //    Using --graphics vnc,listen=0.0.0.0 for remote access or --graphics spice for better performance if client supports it.
    //    --noautoconsole prevents it from automatically trying to connect to the console.
    console.log(
      "[INFO] Ensure you have permissions to run virt-install (often requires sudo)."
    );
    const virtInstallCommand = `\
sudo virt-install \\
    --name ${VM_NAME} \\
    --memory ${VM_MEMORY} \\
    --vcpus ${VM_VCPUS} \\
    --disk path=${vmDiskPath},device=disk,bus=virtio,format=qcow2 \\
    --disk path=${cloudInitIsoPath},device=cdrom \\
    --os-variant ${SELECTED_OS.variant} \\
    --virt-type kvm \\
    --graphics vnc,listen=0.0.0.0 \\
    --network network=${network},model=virtio \\
    --import \\
    --noautoconsole`;
    // For Ubuntu Noble (24.04), 'ubuntunoble' is the expected os-variant.
    // If 'ubuntunoble' isn't recognized, try a more generic 'ubuntu22.04' or 'generic' and check 'osinfo-query os'.

    await runCommand(virtInstallCommand, `Create and start KVM VM ${VM_NAME}`);

    console.log(`\n--- VM ${VM_NAME} Creation Process Completed ---`);
    console.log(`VM Disk: ${vmDiskPath}`);
    console.log(`Cloud-init ISO: ${cloudInitIsoPath}`);
    console.log(`\n[NEXT STEPS]`);
    console.log(`1. Check VM status: sudo virsh list --all`);
    console.log(
      `2. If running, find its IP address: sudo virsh domifaddr ${VM_NAME}`
    );
    console.log(
      `   (Cloud-init might take a minute or two to apply network settings and get an IP)`
    );
    console.log(
      `3. Connect via SSH: ssh ${USERNAME}@<VM_IP_ADDRESS> (using the SSH key you provided)`
    );
    console.log(
      `4. To access the console/display: Use a VNC client to connect to your host's IP and the VNC port assigned by libvirt (check with 'sudo virsh vncdisplay ${VM_NAME}')`
    );
    console.log(
      `5. To manage the VM: sudo virsh <command> ${VM_NAME} (e.g., shutdown, start, destroy)`
    );
    res.status(200).json({'create': 'true'})
  } catch (error) {
    console.error("\n[FATAL] Script failed during execution.");
    // Error is already logged by runCommand
    res.status(400).json({'error': 'failed'})
  }
}

module.exports = {
  createKvmVm
}
