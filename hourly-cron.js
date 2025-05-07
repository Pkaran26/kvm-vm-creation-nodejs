const { exec } = require("child_process");
const cron = require("node-cron");
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
cron.schedule("0 * * * *", fetchVmUsage);

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
