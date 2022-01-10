"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const redis_1 = __importDefault(require("../redis"));
const auth_1 = __importDefault(require("../auth"));
const prisma = new client_1.PrismaClient();
const redisClient = (0, redis_1.default)();
function service(app) {
    app.post("/outbound/sms/", auth_1.default, (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const { id } = req.user;
            const { to, from, text } = req.body;
            const key = `${to}${from}`;
            const value = yield redisClient.get(key);
            if (value) {
                return res.json({
                    message: "",
                    error: `sms from ${from} to ${to} blocked by STOP request`,
                });
            }
            const phone_number = yield prisma.phone_number.findFirst({
                where: {
                    account_id: id,
                    number: from,
                },
            }).catch(error => { throw error; });
            if (!phone_number) {
                return res.status(404).json({
                    message: "",
                    error: `'from' parameter not found.`,
                });
            }
            let numberStat = ((yield redisClient.exists(from)) &&
                JSON.parse((yield redisClient.get(`${from}`)))) ||
                null;
            const _24hrs = 24 * 60 * 60 * 1000;
            if (!numberStat) {
                const createdAt = Date.now();
                const expiresAt = createdAt + _24hrs;
                const stat = { count: 1, createdAt, expiresAt };
                yield redisClient.set(from, JSON.stringify(stat));
            }
            else {
                numberStat = JSON.parse(numberStat);
                if (numberStat.count >= 50) {
                    if (Date.now() > numberStat.expiresAt) {
                        // it is time to reset the count;
                        numberStat.count = 1;
                        numberStat.createdAt = Date.now();
                        numberStat.expiresAt = numberStat.createdAt + _24hrs;
                        yield redisClient.set(from, JSON.stringify(numberStat));
                    }
                    else {
                        return res.status(403).json({
                            message: "",
                            error: `limit reached for from ${from}`,
                        });
                    }
                }
                else {
                    numberStat.count += 1;
                    yield redisClient.set(from, JSON.stringify(numberStat));
                }
            }
            res.json({
                message: "inbound sms ok",
                error: "",
            });
        }
        catch (error) {
            console.error("Eror occurred in outbound");
            return res.status(500).json({
                message: "",
                error: "Unknown failure",
                msg: error
            });
        }
    }));
    app.use("*", (req, res) => __awaiter(this, void 0, void 0, function* () {
        res.status(405).json({
            message: "",
            error: "Invalid route.",
        });
    }));
}
exports.default = service;
