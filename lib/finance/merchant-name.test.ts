import { expect, test } from "vitest";
import { tidyMerchantName } from "./merchant-name";

test.each([
  ["OAK APARTMENTS RENT ACH", "Oak Apartments Rent"],
  ["PUBLIX #1234", "Publix"],
  ["SHELL OIL 57444", "Shell Oil"],
  ["NETFLIX.COM", "Netflix"],
  ["APPLE.COM/BILL", "Apple"],
  ["AMC THEATRES #0414", "AMC Theatres"],
  ["CVS PHARMACY", "CVS Pharmacy"],
  ["SPOTIFY USA", "Spotify USA"],
  ["AT&T WIRELESS", "AT&T Wireless"],
  ["Corner Bakery #12", "Corner Bakery #12"],
  ["AMAZON.COM*AB123", "Amazon"],
  ["SQ *COFFEE SHOP", "Coffee Shop"],
  ["TST* FOO GRILL", "Foo Grill"],
  ["KROGER/FUEL", "Kroger/Fuel"],
  ["12345", "12345"],
  ["#1234", "#1234"],
])("%s reads %s", (raw, tidy) => {
  expect(tidyMerchantName(raw)).toBe(tidy);
});
