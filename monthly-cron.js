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
cron.schedule("0 0 1 * *", generateMonthlyInvoices);

// ... (rest of your API endpoints from previous responses) ...

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log("VM usage scheduled to be fetched every hour.");
  console.log(
    "Monthly invoice generation scheduled for the 1st of every month."
  );
});
