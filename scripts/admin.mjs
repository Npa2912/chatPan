import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
const email = z.email().parse(process.argv[2]).toLowerCase();
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
try {
  await db.user.update({ where: { email }, data: { role: "ADMIN" } });
  console.log("Administrator role granted to the specified account.");
} finally {
  await db.$disconnect();
}
