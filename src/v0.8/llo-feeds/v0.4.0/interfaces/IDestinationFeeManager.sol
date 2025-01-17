// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC165} from "../../../vendor/openzeppelin-solidity/v4.8.3/contracts/interfaces/IERC165.sol";
import {Common} from "../../libraries/Common.sol";

interface IDestinationFeeManager is IERC165 {
  /**
   * @notice Calculate the applied fee and the reward from a report. If the sender is a subscriber, they will receive a discount.
   * @param subscriber address trying to verify
   * @param report report to calculate the fee for
   * @param quoteAddress address of the quote payment token
   * @return (fee, reward, totalDiscount) fee and the reward data with the discount applied
   */
  function getFeeAndReward(
    address subscriber,
    bytes memory report,
    address quoteAddress
  ) external returns (Common.Asset memory, Common.Asset memory, uint256);

  /**
   * @notice Sets the native surcharge
   * @param surcharge surcharge to be paid if paying in native
   */
  function setNativeSurcharge(uint64 surcharge) external;

  /**
   * @notice Adds a subscriber to the fee manager
   * @param subscriber address of the subscriber
   * @param feedId feed id to apply the discount to
   * @param token token to apply the discount to
   * @param discount discount to be applied to the fee
   */
  function updateSubscriberDiscount(address subscriber, bytes32 feedId, address token, uint64 discount) external;

  /**
   * @notice Adds a subscriber to the fee manager
   * @param subscriber address of the subscriber
   * @param token token to apply the discount to
   * @param discount discount to be applied to the fee
   */
  function updateSubscriberGlobalDiscount(address subscriber, address token, uint64 discount) external;

  /**
   * @notice Withdraws any native or PLI rewards to the owner address
   * @param assetAddress address of the asset to withdraw
   * @param recipientAddress address to withdraw to
   * @param quantity quantity to withdraw
   */
  function withdraw(address assetAddress, address recipientAddress, uint192 quantity) external;

  /**
   * @notice Returns the pli balance of the fee manager
   * @return pli balance of the fee manager
   */
  function pliAvailableForPayment() external returns (uint256);

  /**
   * @notice Admin function to pay the PLI deficit for a given config digest
   * @param configDigest the config digest to pay the deficit for
   */
  function payPliDeficit(bytes32 configDigest) external;

  /**
   * @notice Adds the verifier to the list of verifiers able to use the feeManager
   * @param verifier address of the verifier
   */
  function addVerifier(address verifier) external;

  /**
   * @notice Removes the verifier from the list of verifiers able to use the feeManager
   * @param verifier address of the verifier
   */
  function removeVerifier(address verifier) external;

  /**
   * @notice Sets the reward manager to the address
   * @param rewardManager address of the reward manager
   */
  function setRewardManager(address rewardManager) external;

  /**
   * @notice The structure to hold a fee and reward to verify a report
   * @param digest the digest linked to the fee and reward
   * @param fee the fee paid to verify the report
   * @param reward the reward paid upon verification
   & @param appliedDiscount the discount applied to the reward
   */
  struct FeeAndReward {
    bytes32 configDigest;
    Common.Asset fee;
    Common.Asset reward;
    uint256 appliedDiscount;
  }

  /**
   * @notice The structure to hold quote metadata
   * @param quoteAddress the address of the quote
   */
  struct Quote {
    address quoteAddress;
  }
}
