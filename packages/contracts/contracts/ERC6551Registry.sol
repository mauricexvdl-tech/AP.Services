// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IERC6551Registry.sol";

/**
 * @title ERC6551Registry
 * @notice Canonical factory for deploying Token Bound Accounts via CREATE2.
 *
 * This is a minimal, permissionless registry based on EIP-6551. It deploys
 * ERC-1167 minimal proxies pointing to a given account implementation.
 * Account addresses are fully deterministic — computable off-chain from
 * (implementation, salt, chainId, tokenContract, tokenId).
 *
 * Deployed once per chain; all APORIA agents share this registry.
 */
contract ERC6551Registry is IERC6551Registry {

    error AccountCreationFailed();

    /// @inheritdoc IERC6551Registry
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address) {
        // ERC-1167 minimal proxy with immutable args appended after the bytecode.
        // The appended data (salt, chainId, tokenContract, tokenId) is read by
        // the account implementation to identify which NFT owns it.
        bytes memory code = _creationCode(implementation, salt, chainId, tokenContract, tokenId);

        address _account;
        assembly {
            _account := create2(0, add(code, 0x20), mload(code), salt)
        }

        if (_account == address(0)) revert AccountCreationFailed();

        emit ERC6551AccountCreated(
            _account,
            implementation,
            salt,
            chainId,
            tokenContract,
            tokenId
        );

        return _account;
    }

    /// @inheritdoc IERC6551Registry
    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address) {
        bytes32 bytecodeHash = keccak256(
            _creationCode(implementation, salt, chainId, tokenContract, tokenId)
        );

        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), address(this), salt, bytecodeHash)
                    )
                )
            )
        );
    }

    /**
     * @dev Build the ERC-1167 minimal proxy creation bytecode with immutable args.
     *
     * Layout: [ERC-1167 proxy bytecode] ++ abi.encode(salt, chainId, tokenContract, tokenId)
     *
     * The account implementation reads the trailing data to discover which
     * NFT it belongs to, without requiring constructor arguments or storage slots.
     */
    function _creationCode(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            // ERC-1167 minimal proxy prefix (delegatecalls to `implementation`)
            hex"3d60ad80600a3d3981f3363d3d373d3d3d363d73",
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3",
            // Immutable args appended after the runtime bytecode
            abi.encode(salt, chainId, tokenContract, tokenId)
        );
    }
}
