// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title Plugin Functions DON billing interface.
interface IFunctionsBilling {
  /// @notice Return the current conversion from WEI of ETH to PLI from the configured Plugin data feed
  /// @return weiPerUnitPli - The amount of WEI in one PLI
  function getWeiPerUnitPli() external view returns (uint256);

  /// @notice Return the current conversion from PLI to USD from the configured Plugin data feed
  /// @return weiPerUnitPli - The amount of USD that one PLI is worth
  /// @return decimals - The number of decimals that should be represented in the price feed's response
  function getUsdPerUnitPli() external view returns (uint256, uint8);

  /// @notice Determine the fee that will be split between Node Operators for servicing a request
  /// @param requestCBOR - CBOR encoded Plugin Functions request data, use FunctionsRequest library to encode a request
  /// @return fee - Cost in Juels (1e18) of PLI
  function getDONFeeJuels(bytes memory requestCBOR) external view returns (uint72);

  /// @notice Determine the fee that will be paid to the Coordinator owner for operating the network
  /// @return fee - Cost in Juels (1e18) of PLI
  function getOperationFeeJuels() external view returns (uint72);

  /// @notice Determine the fee that will be paid to the Router owner for operating the network
  /// @return fee - Cost in Juels (1e18) of PLI
  function getAdminFeeJuels() external view returns (uint72);

  /// @notice Estimate the total cost that will be charged to a subscription to make a request: transmitter gas re-reimbursement, plus DON fee, plus Registry fee
  /// @param - subscriptionId An identifier of the billing account
  /// @param - data Encoded Plugin Functions request data, use FunctionsClient API to encode a request
  /// @param - callbackGasLimit Gas limit for the fulfillment callback
  /// @param - gasPriceWei The blockchain's gas price to estimate with
  /// @return - billedCost Cost in Juels (1e18) of PLI
  function estimateCost(
    uint64 subscriptionId,
    bytes calldata data,
    uint32 callbackGasLimit,
    uint256 gasPriceWei
  ) external view returns (uint96);

  /// @notice Remove a request commitment that the Router has determined to be stale
  /// @param requestId - The request ID to remove
  function deleteCommitment(bytes32 requestId) external;

  /// @notice Oracle withdraw PLI earned through fulfilling requests
  /// @notice If amount is 0 the full balance will be withdrawn
  /// @param recipient where to send the funds
  /// @param amount amount to withdraw
  function oracleWithdraw(address recipient, uint96 amount) external;

  /// @notice Withdraw all PLI earned by Oracles through fulfilling requests
  /// @dev transmitter addresses must support PLI tokens to avoid tokens from getting stuck as oracleWithdrawAll() calls will forward tokens directly to transmitters
  function oracleWithdrawAll() external;
}

// ================================================================
// |                     Configuration state                      |
// ================================================================

struct FunctionsBillingConfig {
  uint32 fulfillmentGasPriceOverEstimationBP; // ══╗ Percentage of gas price overestimation to account for changes in gas price between request and response. Held as basis points (one hundredth of 1 percentage point)
  uint32 feedStalenessSeconds; //                  ║ How long before we consider the feed price to be stale and fallback to fallbackNativePerUnitPli.
  uint32 gasOverheadBeforeCallback; //             ║ Represents the average gas execution cost before the fulfillment callback. This amount is always billed for every request.
  uint32 gasOverheadAfterCallback; //              ║ Represents the average gas execution cost after the fulfillment callback. This amount is always billed for every request.
  uint40 minimumEstimateGasPriceWei; //            ║ The lowest amount of wei that will be used as the tx.gasprice when estimating the cost to fulfill the request
  uint16 maxSupportedRequestDataVersion; //        ║ The highest support request data version supported by the node. All lower versions should also be supported.
  uint64 fallbackUsdPerUnitPli; //                ║ Fallback PLI / USD conversion rate if the data feed is stale
  uint8 fallbackUsdPerUnitPliDecimals; // ════════╝ Fallback PLI / USD conversion rate decimal places if the data feed is stale
  uint224 fallbackNativePerUnitPli; // ═══════════╗ Fallback NATIVE CURRENCY / PLI conversion rate if the data feed is stale
  uint32 requestTimeoutSeconds; // ════════════════╝ How many seconds it takes before we consider a request to be timed out
  uint16 donFeeCentsUsd; // ═══════════════════════════════╗ Additional flat fee (denominated in cents of USD, paid as PLI) that will be split between Node Operators.
  uint16 operationFeeCentsUsd; // ═════════════════════════╝ Additional flat fee (denominated in cents of USD, paid as PLI) that will be paid to the owner of the Coordinator contract.
}
