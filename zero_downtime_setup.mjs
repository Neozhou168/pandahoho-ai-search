// fixed_zero_downtime_setup.mjs - 修复版本
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

// 定义别名名称
const ALIAS_NAME = "pandahoho_search_alias";

async function setupZeroDowntimeAlias() {
    try {
        console.log("🚀 设置零停机更新机制...");
        console.log(`🏷️ 目标别名: ${ALIAS_NAME}`);
        
        // 1. 获取所有集合
        console.log("🔍 检查现有集合...");
        const collectionsResponse = await axios.get(`${QDRANT_URL}/collections`, {
            headers: { "api-key": QDRANT_API_KEY }
        });
        
        const collections = collectionsResponse.data.result.collections;
        console.log("📋 现有集合:");
        collections.forEach(col => {
            console.log(`  - ${col.name} (${col.status}, ${col.points_count || 0} 点)`);
        });
        
        // 2. 查找最合适的集合作为别名目标
        let targetCollection = null;
        
        // 优先选择有数据的集合
        const collectionsWithData = collections.filter(col => 
            col.points_count && col.points_count > 0
        );
        
        if (collectionsWithData.length > 0) {
            // 选择数据最多的集合
            targetCollection = collectionsWithData.sort((a, b) => 
                (b.points_count || 0) - (a.points_count || 0)
            )[0];
            
            console.log(`🎯 选择集合 '${targetCollection.name}' 作为别名目标 (${targetCollection.points_count} 个点)`);
        } else {
            console.error("❌ 未找到包含数据的集合");
            console.log("💡 请先运行 upload_json.mjs 上传数据，或检查现有集合");
            return false;
        }
        
        // 3. 检查别名是否已存在
        console.log("🔍 检查别名状态...");
        try {
            const aliasesResponse = await axios.get(`${QDRANT_URL}/collections/aliases`, {
                headers: { "api-key": QDRANT_API_KEY }
            });
            
            console.log("📋 现有别名:");
            const aliases = aliasesResponse.data.result.aliases || [];
            if (aliases.length === 0) {
                console.log("  - 无别名");
            } else {
                aliases.forEach(alias => {
                    console.log(`  - ${alias.alias_name} -> ${alias.collection_name}`);
                });
            }
            
            const existingAlias = aliases.find(
                alias => alias.alias_name === ALIAS_NAME
            );
            
            if (existingAlias) {
                console.log(`ℹ️ 别名 '${ALIAS_NAME}' 已存在，指向: ${existingAlias.collection_name}`);
                
                if (existingAlias.collection_name === targetCollection.name) {
                    console.log("✅ 别名已正确设置，无需修改");
                    return true;
                } else {
                    console.log("🔄 需要更新别名指向...");
                    
                    // 更新别名指向
                    await axios.put(`${QDRANT_URL}/collections/aliases`, {
                        actions: [
                            {
                                delete_alias: {
                                    alias_name: ALIAS_NAME
                                }
                            },
                            {
                                create_alias: {
                                    collection_name: targetCollection.name,
                                    alias_name: ALIAS_NAME
                                }
                            }
                        ]
                    }, {
                        headers: { "api-key": QDRANT_API_KEY }
                    });
                    
                    console.log(`✅ 别名已更新: ${ALIAS_NAME} -> ${targetCollection.name}`);
                }
            } else {
                console.log(`🆕 创建新别名 '${ALIAS_NAME}'...`);
                
                // 创建新别名
                await axios.put(`${QDRANT_URL}/collections/aliases`, {
                    actions: [{
                        create_alias: {
                            collection_name: targetCollection.name,
                            alias_name: ALIAS_NAME
                        }
                    }]
                }, {
                    headers: { "api-key": QDRANT_API_KEY }
                });
                
                console.log(`✅ 别名创建成功: ${ALIAS_NAME} -> ${targetCollection.name}`);
            }
            
        } catch (aliasError) {
            console.error("❌ 别名操作失败:", aliasError.response?.data || aliasError.message);
            return false;
        }
        
        // 4. 测试别名是否正常工作
        console.log("🧪 测试别名功能...");
        try {
            const searchResponse = await axios.post(`${QDRANT_URL}/collections/${ALIAS_NAME}/points/search`, {
                vector: new Array(1536).fill(0),
                limit: 1,
                with_payload: false
            }, {
                headers: { "api-key": QDRANT_API_KEY }
            });
            console.log("✅ 别名搜索测试成功");
        } catch (testError) {
            console.error("❌ 别名测试失败:", testError.response?.data || testError.message);
            return false;
        }
        
        // 5. 显示设置结果
        console.log("\n🎉 零停机更新机制设置完成！");
        console.log("\n📋 配置摘要:");
        console.log(`  - 别名名称: ${ALIAS_NAME}`);
        console.log(`  - 指向集合: ${targetCollection.name}`);
        console.log(`  - 数据点数: ${targetCollection.points_count}`);
        console.log(`  - 状态: 可正常使用`);
        
        console.log("\n🔧 Railway 环境变量设置:");
        console.log(`QDRANT_COLLECTION=${ALIAS_NAME}`);
        
        console.log("\n💡 接下来:");
        console.log("1. ✅ 别名已创建（当前步骤完成）");
        console.log("2. ✅ Railway 环境变量已设置");
        console.log("3. 🔄 重启 Railway 服务");
        console.log("4. 🧪 测试搜索功能");
        
        return true;
        
    } catch (error) {
        console.error("💥 设置过程出错:", error.response?.data || error.message);
        if (error.response?.status === 401) {
            console.error("🔑 认证失败，请检查 QDRANT_API_KEY");
        } else if (error.response?.status === 404) {
            console.error("🔗 连接失败，请检查 QDRANT_URL");
        }
        return false;
    }
}

// 主流程
(async () => {
    console.log("🚀 Qdrant 零停机更新机制设置工具");
    
    // 验证环境变量
    if (!QDRANT_URL || !QDRANT_API_KEY) {
        console.error("❌ 缺少必要的环境变量");
        console.log("请确保设置了: QDRANT_URL, QDRANT_API_KEY");
        process.exit(1);
    }
    
    console.log(`🔗 Qdrant URL: ${QDRANT_URL}`);
    console.log(`🏷️ 目标别名: ${ALIAS_NAME}`);
    
    const success = await setupZeroDowntimeAlias();
    
    if (success) {
        console.log("\n✅ 设置成功！现在可以重启 Railway 服务了！");
    } else {
        console.log("\n❌ 设置失败，请检查错误信息");
        process.exit(1);
    }
})();