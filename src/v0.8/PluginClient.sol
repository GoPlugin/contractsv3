// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Plugin} from "./Plugin.sol";
import {ENSInterface} from "./interfaces/ENSInterface.sol";
import {PliTokenInterface} from "./shared/interfaces/PliTokenInterface.sol";
import {PluginRequestInterface} from "./interfaces/PluginRequestInterface.sol";
import {OperatorInterface} from "./interfaces/OperatorInterface.sol";
import {PointerInterface} from "./interfaces/PointerInterface.sol";
import {ENSResolver as ENSResolver_Plugin} from "./vendor/ENSResolver.sol";

/**
 * @title The PluginClient contract
 * @notice Contract writers can inherit this contract in order to create requests for the
 * Plugin network
 */
// solhint-disable gas-custom-errors
abstract contract PluginClient {
  using Plugin for Plugin.Request;

  uint256 internal constant PLI_DIVISIBILITY = 10 ** 18;
  uint256 private constant AMOUNT_OVERRIDE = 0;
  address private constant SENDER_OVERRIDE = address(0);
  uint256 private constant ORACLE_ARGS_VERSION = 1;
  uint256 private constant OPERATOR_ARGS_VERSION = 2;
  bytes32 private constant ENS_TOKEN_SUBNAME = keccak256("pli");
  bytes32 private constant ENS_ORACLE_SUBNAME = keccak256("oracle");
  address private constant PLI_TOKEN_POINTER = 0xC89bD4E1632D3A43CB03AAAd5262cbe4038Bc571;

  ENSInterface private s_ens;
  bytes32 private s_ensNode;
  PliTokenInterface private s_pli;
  OperatorInterface private s_oracle;
  uint256 private s_requestCount = 1;
  mapping(bytes32 => address) private s_pendingRequests;

  event PluginRequested(bytes32 indexed id);
  event PluginFulfilled(bytes32 indexed id);
  event PluginCancelled(bytes32 indexed id);

  /**
   * @notice Creates a request that can hold additional parameters
   * @param specId The Job Specification ID that the request will be created for
   * @param callbackAddr address to operate the callback on
   * @param callbackFunctionSignature function signature to use for the callback
   * @return A Plugin Request struct in memory
   */
  function _buildPluginRequest(
    bytes32 specId,
    address callbackAddr,
    bytes4 callbackFunctionSignature
  ) internal pure returns (Plugin.Request memory) {
    Plugin.Request memory req;
    return req._initialize(specId, callbackAddr, callbackFunctionSignature);
  }

  /**
   * @notice Creates a request that can hold additional parameters
   * @param specId The Job Specification ID that the request will be created for
   * @param callbackFunctionSignature function signature to use for the callback
   * @return A Plugin Request struct in memory
   */
  function _buildOperatorRequest(
    bytes32 specId,
    bytes4 callbackFunctionSignature
  ) internal view returns (Plugin.Request memory) {
    Plugin.Request memory req;
    return req._initialize(specId, address(this), callbackFunctionSignature);
  }

  /**
   * @notice Creates a Plugin request to the stored oracle address
   * @dev Calls `pluginRequestTo` with the stored oracle address
   * @param req The initialized Plugin Request
   * @param payment The amount of PLI to send for the request
   * @return requestId The request ID
   */
  function _sendPluginRequest(Plugin.Request memory req, uint256 payment) internal returns (bytes32) {
    return _sendPluginRequestTo(address(s_oracle), req, payment);
  }

  /**
   * @notice Creates a Plugin request to the specified oracle address
   * @dev Generates and stores a request ID, increments the local nonce, and uses `transferAndCall` to
   * send PLI which creates a request on the target oracle contract.
   * Emits PluginRequested event.
   * @param oracleAddress The address of the oracle for the request
   * @param req The initialized Plugin Request
   * @param payment The amount of PLI to send for the request
   * @return requestId The request ID
   */
  function _sendPluginRequestTo(
    address oracleAddress,
    Plugin.Request memory req,
    uint256 payment
  ) internal returns (bytes32 requestId) {
    uint256 nonce = s_requestCount;
    s_requestCount = nonce + 1;
    bytes memory encodedRequest = abi.encodeWithSelector(
      PluginRequestInterface.oracleRequest.selector,
      SENDER_OVERRIDE, // Sender value - overridden by onTokenTransfer by the requesting contract's address
      AMOUNT_OVERRIDE, // Amount value - overridden by onTokenTransfer by the actual amount of PLI sent
      req.id,
      address(this),
      req.callbackFunctionId,
      nonce,
      ORACLE_ARGS_VERSION,
      req.buf.buf
    );
    return _rawRequest(oracleAddress, nonce, payment, encodedRequest);
  }

  /**
   * @notice Creates a Plugin request to the stored oracle address
   * @dev This function supports multi-word response
   * @dev Calls `sendOperatorRequestTo` with the stored oracle address
   * @param req The initialized Plugin Request
   * @param payment The amount of PLI to send for the request
   * @return requestId The request ID
   */
  function _sendOperatorRequest(Plugin.Request memory req, uint256 payment) internal returns (bytes32) {
    return _sendOperatorRequestTo(address(s_oracle), req, payment);
  }

  /**
   * @notice Creates a Plugin request to the specified oracle address
   * @dev This function supports multi-word response
   * @dev Generates and stores a request ID, increments the local nonce, and uses `transferAndCall` to
   * send PLI which creates a request on the target oracle contract.
   * Emits PluginRequested event.
   * @param oracleAddress The address of the oracle for the request
   * @param req The initialized Plugin Request
   * @param payment The amount of PLI to send for the request
   * @return requestId The request ID
   */
  function _sendOperatorRequestTo(
    address oracleAddress,
    Plugin.Request memory req,
    uint256 payment
  ) internal returns (bytes32 requestId) {
    uint256 nonce = s_requestCount;
    s_requestCount = nonce + 1;
    bytes memory encodedRequest = abi.encodeWithSelector(
      OperatorInterface.operatorRequest.selector,
      SENDER_OVERRIDE, // Sender value - overridden by onTokenTransfer by the requesting contract's address
      AMOUNT_OVERRIDE, // Amount value - overridden by onTokenTransfer by the actual amount of PLI sent
      req.id,
      req.callbackFunctionId,
      nonce,
      OPERATOR_ARGS_VERSION,
      req.buf.buf
    );
    return _rawRequest(oracleAddress, nonce, payment, encodedRequest);
  }

  /**
   * @notice Make a request to an oracle
   * @param oracleAddress The address of the oracle for the request
   * @param nonce used to generate the request ID
   * @param payment The amount of PLI to send for the request
   * @param encodedRequest data encoded for request type specific format
   * @return requestId The request ID
   */
  function _rawRequest(
    address oracleAddress,
    uint256 nonce,
    uint256 payment,
    bytes memory encodedRequest
  ) private returns (bytes32 requestId) {
    requestId = keccak256(abi.encodePacked(this, nonce));
    s_pendingRequests[requestId] = oracleAddress;
    emit PluginRequested(requestId);
    require(s_pli.transferAndCall(oracleAddress, payment, encodedRequest), "unable to transferAndCall to oracle");
    return requestId;
  }

  /**
   * @notice Allows a request to be cancelled if it has not been fulfilled
   * @dev Requires keeping track of the expiration value emitted from the oracle contract.
   * Deletes the request from the `pendingRequests` mapping.
   * Emits PluginCancelled event.
   * @param requestId The request ID
   * @param payment The amount of PLI sent for the request
   * @param callbackFunc The callback function specified for the request
   * @param expiration The time of the expiration for the request
   */
  function _cancelPluginRequest(
    bytes32 requestId,
    uint256 payment,
    bytes4 callbackFunc,
    uint256 expiration
  ) internal {
    OperatorInterface requested = OperatorInterface(s_pendingRequests[requestId]);
    delete s_pendingRequests[requestId];
    emit PluginCancelled(requestId);
    requested.cancelOracleRequest(requestId, payment, callbackFunc, expiration);
  }

  /**
   * @notice the next request count to be used in generating a nonce
   * @dev starts at 1 in order to ensure consistent gas cost
   * @return returns the next request count to be used in a nonce
   */
  function _getNextRequestCount() internal view returns (uint256) {
    return s_requestCount;
  }

  /**
   * @notice Sets the stored oracle address
   * @param oracleAddress The address of the oracle contract
   */
  function _setPluginOracle(address oracleAddress) internal {
    s_oracle = OperatorInterface(oracleAddress);
  }

  /**
   * @notice Sets the PLI token address
   * @param pliAddress The address of the PLI token contract
   */
  function _setPluginToken(address pliAddress) internal {
    s_pli = PliTokenInterface(pliAddress);
  }

  /**
   * @notice Sets the Plugin token address for the public
   * network as given by the Pointer contract
   */
  function _setPublicPluginToken() internal {
    _setPluginToken(PointerInterface(PLI_TOKEN_POINTER).getAddress());
  }

  /**
   * @notice Retrieves the stored address of the PLI token
   * @return The address of the PLI token
   */
  function _pluginTokenAddress() internal view returns (address) {
    return address(s_pli);
  }

  /**
   * @notice Retrieves the stored address of the oracle contract
   * @return The address of the oracle contract
   */
  function _pluginOracleAddress() internal view returns (address) {
    return address(s_oracle);
  }

  /**
   * @notice Allows for a request which was created on another contract to be fulfilled
   * on this contract
   * @param oracleAddress The address of the oracle contract that will fulfill the request
   * @param requestId The request ID used for the response
   */
  function _addPluginExternalRequest(
    address oracleAddress,
    bytes32 requestId
  ) internal notPendingRequest(requestId) {
    s_pendingRequests[requestId] = oracleAddress;
  }

  /**
   * @notice Sets the stored oracle and PLI token contracts with the addresses resolved by ENS
   * @dev Accounts for subnodes having different resolvers
   * @param ensAddress The address of the ENS contract
   * @param node The ENS node hash
   */
  function _usePluginWithENS(address ensAddress, bytes32 node) internal {
    s_ens = ENSInterface(ensAddress);
    s_ensNode = node;
    bytes32 pliSubnode = keccak256(abi.encodePacked(s_ensNode, ENS_TOKEN_SUBNAME));
    ENSResolver_Plugin resolver = ENSResolver_Plugin(s_ens.resolver(pliSubnode));
    _setPluginToken(resolver.addr(pliSubnode));
    _updatePluginOracleWithENS();
  }

  /**
   * @notice Sets the stored oracle contract with the address resolved by ENS
   * @dev This may be called on its own as long as `usePluginWithENS` has been called previously
   */
  function _updatePluginOracleWithENS() internal {
    bytes32 oracleSubnode = keccak256(abi.encodePacked(s_ensNode, ENS_ORACLE_SUBNAME));
    ENSResolver_Plugin resolver = ENSResolver_Plugin(s_ens.resolver(oracleSubnode));
    _setPluginOracle(resolver.addr(oracleSubnode));
  }

  /**
   * @notice Ensures that the fulfillment is valid for this contract
   * @dev Use if the contract developer prefers methods instead of modifiers for validation
   * @param requestId The request ID for fulfillment
   */
  function _validatePluginCallback(
    bytes32 requestId
  )
    internal
    recordPluginFulfillment(requestId) // solhint-disable-next-line no-empty-blocks
  {}

  /**
   * @dev Reverts if the sender is not the oracle of the request.
   * Emits PluginFulfilled event.
   * @param requestId The request ID for fulfillment
   */
  modifier recordPluginFulfillment(bytes32 requestId) {
    require(msg.sender == s_pendingRequests[requestId], "Source must be the oracle of the request");
    delete s_pendingRequests[requestId];
    emit PluginFulfilled(requestId);
    _;
  }

  /**
   * @dev Reverts if the request is already pending
   * @param requestId The request ID for fulfillment
   */
  modifier notPendingRequest(bytes32 requestId) {
    require(s_pendingRequests[requestId] == address(0), "Request is already pending");
    _;
  }
}
