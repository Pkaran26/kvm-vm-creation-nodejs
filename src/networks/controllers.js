const express = require("express");
const fs = require('fs');
const { executeCommand, parseCMDResponse } = require("../utils/helper");
const router = express.Router();

// GET /api/networks - Basic endpoint to list network interfaces
router.get("/api/networks", async (req, res) => {
  try {
    const output = await executeCommand("virsh net-list --all");
    res.json(parseCMDResponse(output));
  } catch (error) {
    res.status(500).json({ error: "Failed to list networks", details: error });
  }
});

async function createDefaultNetwork() {
  const networkName = 'myfreenetwork';
  const networkXmlPath = '/etc/libvirt/networks/myfreenetwork.xml';

  try {
      // Check if the network XML file exists
      if (!fs.existsSync(networkXmlPath)) {
          console.log(`Network XML file not found at ${networkXmlPath}. Creating...`);
          //  Use a template string for better readability
          const defaultNetworkXml = `
              <network>
                <name>${networkName}</name>
                <uuid>your-uuid</uuid>
                <forward mode='nat'>
                  <nat>
                    <address start='192.168.122.2' end='192.168.122.254'/>
                  </nat>
                </forward>
                <ip address='192.168.122.1' netmask='255.255.255.0'>
                  <dhcp>
                    <range start='192.168.122.2' end='192.168.122.254'/>
                  </dhcp>
                </ip>
              </network>
          `;

          // Replace 'your-uuid' with a real UUID.
          const uuid = await executeCommand('uuidgen');
          const finalNetworkXml = defaultNetworkXml.replace('your-uuid', uuid);

          // Write the XML to the file
          fs.writeFileSync(networkXmlPath, finalNetworkXml);
          console.log(`Network XML file created at ${networkXmlPath}`);
      }
      else {
          console.log(`Network XML file already exists at ${networkXmlPath}`);
      }


      // Define the network in libvirt
      try {
          await executeCommand(`sudo virsh net-define ${networkXmlPath}`);
          console.log(`Network "${networkName}" defined successfully.`);
      } catch (defineError) {
          if (defineError && defineError.message && defineError.message.includes("already exists")) {
              console.warn(`Network "${networkName}" already exists.  Attempting to start it.`);
          }
          else {
              console.error(`Error defining network: ${defineError}`);
              return;
          }
      }


      // Start the network
      try {
          await executeCommand(`sudo virsh net-start ${networkName}`);
          console.log(`Network "${networkName}" started successfully.`);
      }
      catch (startError) {
           if (startError && startError.message && startError.message.includes("error: Failed to start network")) {
              console.error(`Error starting network "${networkName}": ${startError.message}`);
              return;
          }
          else {
              console.error(`Error starting network: ${startError}`);
              return;
          }
      }


      // Set the network to autostart on boot
      await executeCommand(`sudo virsh net-autostart ${networkName}`);
      console.log(`Network "${networkName}" set to autostart on boot.`);

      // List networks to confirm
      const listNetworksOutput = await executeCommand(`sudo virsh net-list --all`);
      console.log(`Current networks: \n${listNetworksOutput}`);

      console.log(`Successfully configured network "${networkName}"`);

  } catch (error) {
      console.error('Failed to create default network:', error);
      throw error; // Re-throw to be caught by caller, if needed
  }
}

module.exports = router

// Example usage:  Call the function
// createDefaultNetwork()
//   .then(() => {
//     console.log("Default network creation process completed.");
//   })
//   .catch((err) => {
//     console.error("Default network creation process failed:", err);
//   });
