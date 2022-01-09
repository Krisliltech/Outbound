import { PrismaClient } from "@prisma/client";
import { Express, Response } from "express";
import { RequestI as Request } from "../interface";
import redisConnect from "../redis";
import authenticate from "../auth";

const prisma = new PrismaClient();
const redisClient = redisConnect();

function service(app: Express) {
  app.post(
    "/outbound/sms/",
    authenticate,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.user!;
        const { to, from, text } = req.body;
        const key = `${to}${from}`;
        const value = await redisClient.get(key);
        if (value) {
          return res.json({
            message: "",
            error: `sms from ${from} to ${to} blocked by STOP request`,
          });
        }
        const phone_number = await prisma.phone_number.findFirst({
          where: {
            account_id: id,
            number: from,
          },
        });

        if (!phone_number) {
          return res.status(404).json({
            message: "",
            error: `'from' parameter not found.`,
          });
        }
        let numberStat =
          ((await redisClient.exists(from)) &&
            JSON.parse((await redisClient.get(`${from}`)) as string)) ||
          null;
        const _24hrs = 24 * 60 * 60 * 1000;
        if (!numberStat) {
          const createdAt = Date.now();
          const expiresAt = createdAt + _24hrs;
          const stat = { count: 1, createdAt, expiresAt };
          await redisClient.set(from, JSON.stringify(stat));
        } else {
          numberStat = JSON.parse(numberStat) as {
            count: number;
            createdAt: number;
            expiresAt: number;
          };
          if (numberStat.count >= 50) {
            if (Date.now() > numberStat.expiresAt) {
              // it is time to reset the count;
              numberStat.count = 1;
              numberStat.createdAt = Date.now();
              numberStat.expiresAt = numberStat.createdAt + _24hrs;
              await redisClient.set(from, JSON.stringify(numberStat));
            } else {
              return res.status(403).json({
                message: "",
                error: `limit reached for from ${from}`,
              });
            }
          } else {
            numberStat.count += 1;
            await redisClient.set(from, JSON.stringify(numberStat));
          }
        }

        res.json({
          message: "inbound sms ok",
          error: "",
        });
      } catch (error) {
        return res.status(500).json({
          message: "",
          error: "Unknown failure",
        });
      }
    }
  );

  app.use("*", async (req: Request, res: Response) => {
    res.status(405).json({
      message: "",
      error: "Invalid route.",
    });
  });
}

export default service;
