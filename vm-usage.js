// Filename: server.js
const express = require("express");
const { exec } = require("child_process");
const bodyParser = require("body-parser");
const fs = require("fs").promises;
const path = require("path");
// const cron = require("node-cron");
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./vm_billing.db"); // Create or connect to SQLite database

// Initialize database tables if they don't exist
db.serialize(() => {
  db.run(
    "CREATE TABLE IF NOT EXISTS vms (name TEXT UNIQUE, user_id TEXT, plan_id INTEGER)"
  );
  db.run(
    "CREATE TABLE IF NOT EXISTS usage (vm_name TEXT, timestamp INTEGER, cpu_user INTEGER, cpu_system INTEGER, memory_actual INTEGER, memory_swap_in INTEGER)"
  );
  db.run(
    "CREATE TABLE IF NOT EXISTS plans (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, cpu_hourly_cost REAL, memory_hourly_cost REAL)"
  );
  db.run(
    "CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, billing_start INTEGER, billing_end INTEGER, total_cost REAL, generation_date INTEGER, usage_details TEXT)"
  );
});

const app = express();
const port = 3000;

app.use(bodyParser.json());

const ISO_DOWNLOAD_PATH = "/var/lib/libvirt/images/isos"; // Adjust as needed
const VM_IMAGE_BASE_PATH = "/var/lib/libvirt/images"; // Adjust as needed

// Ensure the download directories exist
fs.mkdir(ISO_DOWNLOAD_PATH, { recursive: true }).catch((err) => {
  console.error(`Error creating ISO download directory: ${err}`);
});
fs.mkdir(VM_IMAGE_BASE_PATH, { recursive: true }).catch((err) => {
  console.error(`Error creating VM image directory: ${err}`);
});

const executeCommand = (command, timeout = undefined) => {
  return new Promise((resolve, reject) => {
    exec(command, { timeout }, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing command: ${command}`);
        console.error(stderr);
        reject(stderr);
        return;
      }
      resolve(stdout.trim());
    });
  });
};

// Function to fetch CPU usage for a VM
async function getVmCpuUsage(vmName) {
  try {
    const output = await executeCommand(`virsh domstats ${vmName} --cpu-total`);
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.startsWith("cpu.total.user") ||
          line.startsWith("cpu.total.system")
      );
    let userTime = 0;
    let systemTime = 0;
    lines.forEach((line) => {
      const [key, value] = line.split("=").map((item) => item.trim());
      if (key === "cpu.total.user") {
        userTime = parseInt(value, 10);
      } else if (key === "cpu.total.system") {
        systemTime = parseInt(value, 10);
      }
    });
    // This is a very basic snapshot. More sophisticated monitoring would involve deltas over time.
    return { user: userTime, system: systemTime };
  } catch (error) {
    console.error(`Error fetching CPU usage for ${vmName}:`, error);
    return null;
  }
}

// Function to fetch memory usage for a VM
async function getVmMemoryUsage(vmName) {
  try {
    const output = await executeCommand(`virsh dommemstat ${vmName}`);
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) => line.startsWith("actual=") || line.startsWith("swap_in=")
      );
    let actual = 0;
    let swapIn = 0;
    lines.forEach((line) => {
      const [key, value] = line.split("=").map((item) => item.trim());
      if (key === "actual") {
        actual = parseInt(value, 10);
      } else if (key === "swap_in") {
        swapIn = parseInt(value, 10);
      }
    });
    return { actual: actual, swapIn: swapIn };
  } catch (error) {
    console.error(`Error fetching memory usage for ${vmName}:`, error);
    return null;
  }
}

// Function to get a list of running VMs
async function getRunningVms() {
  try {
    const output = await executeCommand("virsh list --name --state-running");
    return output.split("\n").filter((name) => name !== "");
  } catch (error) {
    console.error("Error listing running VMs:", error);
    return [];
  }
}

// Function to fetch and store VM usage (hourly)
async function fetchVmUsage() {
  console.log("Fetching and storing VM usage (hourly)...");
  const runningVms = await getRunningVms();
  const timestamp = Date.now();
  for (const vmName of runningVms) {
    const cpuUsage = await getVmCpuUsage(vmName);
    const memoryUsage = await getVmMemoryUsage(vmName);
    if (cpuUsage && memoryUsage) {
      console.log(vmName,
        timestamp,
        cpuUsage.user,
        cpuUsage.system,
        memoryUsage.actual,
        memoryUsage.swapIn);
      
      db.run(
        "INSERT INTO usage (vm_name, timestamp, cpu_user, cpu_system, memory_actual, memory_swap_in) VALUES (?, ?, ?, ?, ?, ?)",
        vmName,
        timestamp,
        cpuUsage.user,
        cpuUsage.system,
        memoryUsage.actual,
        memoryUsage.swapIn,
        (err) => {
          if (err) {
            console.error(`Error storing usage for ${vmName}:`, err.message);
          }
        }
      );
    }
  }
  console.log("VM usage fetched and stored (hourly).");
}

// Schedule the fetchVmUsage function to run every hour
// cron.schedule("0 * * * *", fetchVmUsage);

// Function to get VM plan ID
function getVmPlanId(vmName) {
  return new Promise((resolve, reject) => {
    db.get("SELECT plan_id FROM vms WHERE name = ?", vmName, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row ? row.plan_id : null);
    });
  });
}

// Function to get subscription plan details
function getSubscriptionPlan(planId) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT cpu_hourly_cost, memory_hourly_cost FROM plans WHERE id = ?",
      planId,
      (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(row);
      }
    );
  });
}

// Function to calculate and generate invoices for the previous month (monthly)
async function generateMonthlyInvoices() {
  console.log("Generating monthly invoices (monthly)...");
  const now = new Date();
  const firstDayOfLastMonth = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1
  ).getTime();
  const lastDayOfLastMonth = new Date(
    now.getFullYear(),
    now.getMonth(),
    0,
    23,
    59,
    59,
    999
  ).getTime();
  const invoiceGenerationDate = Date.now();

  db.all("SELECT name, user_id FROM vms", async (err, vms) => {
    if (err) {
      console.error("Error fetching VMs for invoice generation:", err.message);
      return;
    }

    for (const vm of vms) {
      const planId = await getVmPlanId(vm.name);
      if (planId) {
        const plan = await getSubscriptionPlan(planId);
        if (plan) {
          db.all(
            "SELECT timestamp, cpu_user, cpu_system, memory_actual FROM usage WHERE vm_name = ? AND timestamp >= ? AND timestamp <= ?",
            vm.name,
            firstDayOfLastMonth,
            lastDayOfLastMonth,
            async (usageErr, usageData) => {
              if (usageErr) {
                console.error(
                  `Error fetching usage for ${vm.name}:`,
                  usageErr.message
                );
                return;
              }

              console.log(usageData);
              

              let totalCpuHours = usageData.length; // Simplistic - needs proper time difference calculation
              let totalMemoryGBHours = 0;
              const monthlyUsageSummary = {
                totalCpuHours,
                totalMemoryGB: 0, // Will store the sum of memory in GB
              };

              for (const u of usageData) {
                monthlyUsageSummary.totalMemoryGB +=
                  u.memory_actual / (1024 * 1024); // Convert KB to GB
              }

              const cpuCost = totalCpuHours * plan.cpu_hourly_cost;
              const averageMemoryGB =
                usageData.length > 0
                  ? monthlyUsageSummary.totalMemoryGB / usageData.length
                  : 0;
              const memoryCost =
                averageMemoryGB * plan.memory_hourly_cost * totalCpuHours; // Cost based on average

              const totalCost = cpuCost + memoryCost;
              const usageDetails = JSON.stringify(monthlyUsageSummary); // Store a summary for monthly invoice

              console.log(vm.user_id,
                firstDayOfLastMonth,
                lastDayOfLastMonth,
                totalCost,
                invoiceGenerationDate,
                usageDetails);
              
              db.run(
                "INSERT INTO invoices (user_id, billing_start, billing_end, total_cost, generation_date, usage_details) VALUES (?, ?, ?, ?, ?, ?)",
                vm.user_id,
                firstDayOfLastMonth,
                lastDayOfLastMonth,
                totalCost,
                invoiceGenerationDate,
                usageDetails,
                (invoiceErr) => {
                  if (invoiceErr) {
                    console.error(
                      `Error generating invoice for ${vm.name}:`,
                      invoiceErr.message
                    );
                  } else {
                    console.log(
                      `Monthly invoice generated for ${vm.name}, User: ${
                        vm.user_id
                      }, Cost: ${totalCost.toFixed(2)}`
                    );
                  }
                }
              );
            }
          );
        } else {
          console.warn(`Subscription plan not found for VM: ${vm.name}`);
        }
      } else {
        console.warn(`No subscription plan associated with VM: ${vm.name}`);
      }
    }
    console.log("Monthly invoices generated (monthly).");
  });
}

// Schedule the monthly invoice generation for the 1st of every month at midnight
// cron.schedule("0 0 1 * *", generateMonthlyInvoices);

// ... (rest of your API endpoints) ...
// fetchVmUsage()
generateMonthlyInvoices()

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log("VM usage scheduled to be fetched every hour.");
  console.log(
    "Monthly invoice generation scheduled for the 1st of every month."
  );
});
