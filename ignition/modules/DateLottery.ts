import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("DateLotteryModule", (m) => {
  const dateLottery = m.contract("DateLottery");
  return { dateLottery };
});
