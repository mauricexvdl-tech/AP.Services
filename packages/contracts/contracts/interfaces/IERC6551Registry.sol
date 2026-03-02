// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IERC6551Registry
 * @notice Canonical registry for creating Token Bound Accounts (EIP-6551).
 *
 * The registry is a permissionless factory: anyone can create a TBA
 * for any ERC-721 token. Account addresses are deterministic —
 * computed via CREATE2 from (implementation, salt, chainId, tokenContract, tokenId).
 */
interface IERC6551Registry {
    event ERC6551AccountCreated(
        address account,
        address indexed implementation,
        bytes32 salt,
        uint256 chainId,
        address indexed tokenContract,
        uint256 indexed tokenId
    );

    /**
     * @notice Deploy a new TBA for a given ERC-721 token.
     * @dev Uses CREATE2 so the address is deterministic. Reverts if already deployed.
     */
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address account);

    /**
     * @notice Compute the TBA address without deploying.
     */
    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address account);
}
