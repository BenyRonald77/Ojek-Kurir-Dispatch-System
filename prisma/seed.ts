import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const customer = await prisma.user.upsert({
    where: { email: "customer@ojek.dev" },
    update: {},
    create: { name: "Dina Pelanggan", email: "customer@ojek.dev", passwordHash, role: "CUSTOMER" },
  });

  const driverDefs = [
    { email: "driver1@ojek.dev", name: "Andi Driver", vehicleType: "Motor" },
    { email: "driver2@ojek.dev", name: "Budi Driver", vehicleType: "Motor" },
    { email: "driver3@ojek.dev", name: "Citra Driver", vehicleType: "Mobil" },
  ];

  for (const d of driverDefs) {
    const user = await prisma.user.upsert({
      where: { email: d.email },
      update: {},
      create: { name: d.name, email: d.email, passwordHash, role: "DRIVER" },
    });
    await prisma.driverProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, vehicleType: d.vehicleType, isOnline: false, isAvailable: false },
    });
  }

  console.log("Seed selesai.");
  console.log("Login pelanggan: customer@ojek.dev / password123");
  console.log("Login driver: driver1@ojek.dev, driver2@ojek.dev, driver3@ojek.dev / password123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
